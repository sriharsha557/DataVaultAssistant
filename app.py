import os
import json
import threading
from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename
import requests
from datetime import datetime
from contextlib import contextmanager
import sqlite3

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
app.config['ALLOWED_EXTENSIONS'] = {'png', 'jpg', 'jpeg', 'pdf', 'gif'}

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Environment variables
OCR_API_KEY = os.getenv('OCR_SPACE_KEY', '')
GROQ_API_KEY = os.getenv('GROQ_API_KEY', '')
TURSO_URL = os.getenv('TURSO_DATABASE_URL', '')
TURSO_TOKEN = os.getenv('TURSO_AUTH_TOKEN', '')

# Force SQLite for stability - Turso causing worker kills
USE_TURSO = False  # Disabled due to memory issues on Render free tier
if TURSO_URL and TURSO_TOKEN:
    print("⚠️ Turso credentials found but disabled (use SQLite for stability)", flush=True)

print(f"🔧 Database: SQLite (stable mode)", flush=True)
print(f"🔑 OCR configured: {bool(OCR_API_KEY)}", flush=True)
print(f"🔑 GROQ configured: {bool(GROQ_API_KEY)}", flush=True)

# Thread-local storage
_local = threading.local()
_db_initialized = False
_db_init_lock = threading.Lock()

def get_sqlite_connection():
    """Get thread-safe SQLite connection"""
    if not hasattr(_local, 'conn') or _local.conn is None:
        try:
            os.makedirs('db', exist_ok=True)
            _local.conn = sqlite3.connect(
                'db/datavault.db',
                timeout=30.0,
                check_same_thread=False,
                isolation_level='DEFERRED'
            )
            _local.conn.row_factory = sqlite3.Row
            # WAL mode for better concurrency
            _local.conn.execute('PRAGMA journal_mode=WAL')
            _local.conn.execute('PRAGMA busy_timeout=30000')
            _local.conn.execute('PRAGMA synchronous=NORMAL')  # Faster writes
            _local.conn.execute('PRAGMA cache_size=10000')    # More memory for cache
            print(f"✅ SQLite connection created for thread {threading.current_thread().name}", flush=True)
        except Exception as e:
            print(f"❌ SQLite connection error: {e}", flush=True)
            raise
    
    return _local.conn

def init_db():
    """Initialize database with required tables"""
    global _db_initialized
    
    if _db_initialized:
        return True
    
    with _db_init_lock:
        if _db_initialized:
            return True
        
        try:
            print("🔄 Initializing database...", flush=True)
            conn = get_sqlite_connection()
            cursor = conn.cursor()
            
            # Create tables
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ocr_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL,
                    extracted_text TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS dv_models (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ocr_id INTEGER NOT NULL,
                    model_json TEXT NOT NULL,
                    grounded INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (ocr_id) REFERENCES ocr_results(id)
                )
            """)
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS knowledge_docs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Create indexes
            try:
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_ocr_created ON ocr_results(created_at DESC)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_models_ocr ON dv_models(ocr_id)")
            except:
                pass
            
            conn.commit()
            _db_initialized = True
            print("✅ Database initialized", flush=True)
            return True
            
        except Exception as e:
            print(f"❌ Database init error: {e}", flush=True)
            import traceback
            traceback.print_exc()
            return False

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def extract_text_ocr(filepath):
    """Extract text from image using OCR.space API"""
    if not OCR_API_KEY:
        raise ValueError("OCR_SPACE_KEY not configured")
    
    try:
        print(f"📤 Sending to OCR.space...", flush=True)
        
        with open(filepath, 'rb') as f:
            response = requests.post(
                'https://api.ocr.space/parse/image',
                files={'file': f},
                data={
                    'apikey': OCR_API_KEY,
                    'language': 'eng',
                    'isOverlayRequired': 'false',
                    'detectOrientation': 'true',
                    'scale': 'true',
                    'OCREngine': '2'
                },
                timeout=120
            )
        
        print(f"📥 OCR status: {response.status_code}", flush=True)
        response.raise_for_status()
        result = response.json()
        
        if result.get('IsErroredOnProcessing'):
            raise Exception(result.get('ErrorMessage', 'OCR failed'))
        
        if not result.get('ParsedResults') or len(result['ParsedResults']) == 0:
            raise Exception('No OCR results')
        
        text = result['ParsedResults'][0].get('ParsedText', '')
        if not text:
            raise Exception('Empty OCR text')
        
        print(f"✅ OCR extracted {len(text)} chars", flush=True)
        return text
    
    except requests.exceptions.Timeout:
        raise Exception("OCR timeout - try smaller image")
    except Exception as e:
        print(f"❌ OCR error: {e}", flush=True)
        raise Exception(f"OCR error: {str(e)}")

def validate_dv_model(model):
    """Validate model structure"""
    if not isinstance(model, dict):
        raise ValueError("Model must be dict")
    if 'nodes' not in model or not isinstance(model['nodes'], list):
        raise ValueError("Model must have 'nodes' array")
    if len(model['nodes']) == 0:
        raise ValueError("Model must have nodes")
    
    node_ids = set()
    for node in model['nodes']:
        if 'id' not in node or not node['id']:
            raise ValueError("All nodes need 'id'")
        if 'type' not in node:
            raise ValueError(f"Node {node['id']} needs 'type'")
        node_ids.add(node['id'])
    
    return True

def generate_dv_model(ocr_text, grounded=False, knowledge_content=''):
    """Generate Data Vault model using GROQ"""
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY not configured")
    
    system_prompt = "You are an expert Data Vault 2.1 modeler."
    if grounded and knowledge_content:
        system_prompt = f"""You are a Data Vault 2.1 expert. Use these guidelines:
{knowledge_content[:2000]}"""
    
    user_prompt = f"""Convert this schema to Data Vault 2.1:

{ocr_text[:3000]}

Return ONLY valid JSON (no markdown):
{{
  "nodes": [
    {{"id": "Hub_Customer", "type": "hub", "businessKey": "customer_id", "attributes": ["customer_id"]}},
    {{"id": "Sat_Customer", "type": "satellite", "parent": "Hub_Customer", "attributes": ["name", "email"]}},
    {{"id": "Link_Customer_Order", "type": "link", "connects": ["Hub_Customer", "Hub_Order"]}}
  ],
  "edges": [
    {{"from": "Hub_Customer", "to": "Sat_Customer"}},
    {{"from": "Hub_Customer", "to": "Link_Customer_Order"}}
  ]
}}

RULES:
- Every satellite needs edge to parent
- Every link needs edges to all hubs
- Use "from" and "to" (not source/target)"""
    
    try:
        print(f"🤖 Calling GROQ...", flush=True)
        
        response = requests.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {GROQ_API_KEY}',
                'Content-Type': 'application/json'
            },
            json={
                'model': 'llama-3.3-70b-versatile',
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt}
                ],
                'temperature': 0.1,
                'max_tokens': 3000
            },
            timeout=60
        )
        
        print(f"📥 GROQ status: {response.status_code}", flush=True)
        response.raise_for_status()
        result = response.json()
        
        if 'error' in result:
            raise Exception(f"GROQ error: {result['error'].get('message')}")
        
        if not result.get('choices'):
            raise Exception('No GROQ response')
        
        content = result['choices'][0]['message']['content'].strip()
        content = content.replace('```json', '').replace('```', '').strip()
        
        model = json.loads(content)
        validate_dv_model(model)
        
        if 'edges' not in model:
            model['edges'] = []
        
        # Auto-generate missing edges
        node_lookup = {n['id']: n for n in model['nodes']}
        existing = {(e.get('from'), e.get('to')) for e in model['edges']}
        
        auto_count = 0
        for node in model['nodes']:
            if node['type'] == 'satellite' and node.get('parent'):
                pid = node['parent']
                if (pid, node['id']) not in existing:
                    model['edges'].append({'from': pid, 'to': node['id']})
                    auto_count += 1
            
            elif node['type'] == 'link' and node.get('connects'):
                for hid in node['connects']:
                    if (hid, node['id']) not in existing:
                        model['edges'].append({'from': hid, 'to': node['id']})
                        auto_count += 1
        
        if auto_count > 0:
            print(f"✅ Auto-created {auto_count} edges", flush=True)
        
        print(f"✅ Model: {len(model['nodes'])} nodes, {len(model['edges'])} edges", flush=True)
        return model
    
    except Exception as e:
        print(f"❌ Generation error: {e}", flush=True)
        raise

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/config/check', methods=['GET'])
def check_config():
    """Health check"""
    try:
        if not _db_initialized:
            init_db()
        
        return jsonify({
            'ocr_configured': bool(OCR_API_KEY),
            'groq_configured': bool(GROQ_API_KEY),
            'database': 'SQLite',
            'database_ready': _db_initialized
        }), 200
    except Exception as e:
        return jsonify({
            'ocr_configured': bool(OCR_API_KEY),
            'groq_configured': bool(GROQ_API_KEY),
            'database': 'Error',
            'error': str(e)
        }), 500

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Handle file upload and OCR"""
    print("=" * 60, flush=True)
    print("📤 Upload request received", flush=True)
    
    try:
        if not _db_initialized:
            init_db()
        
        if 'file' not in request.files:
            return jsonify({'error': 'No file'}), 400
        
        file = request.files['file']
        print(f"📄 File: {file.filename}", flush=True)
        
        if not file.filename or not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file'}), 400
        
        filepath = None
        
        try:
            filename = secure_filename(file.filename)
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            print(f"✅ File saved", flush=True)
            
            # OCR extraction
            extracted_text = extract_text_ocr(filepath)
            print(f"✅ Text extracted: {len(extracted_text)} chars", flush=True)
            
            # Store in database - with explicit error handling
            print(f"💾 Storing in database...", flush=True)
            
            try:
                conn = get_sqlite_connection()
                cursor = conn.cursor()
                
                # Simple, fast insert
                cursor.execute(
                    "INSERT INTO ocr_results (filename, extracted_text, created_at) VALUES (?, ?, ?)",
                    (filename, extracted_text, datetime.now().isoformat())
                )
                
                ocr_id = cursor.lastrowid
                conn.commit()
                
                print(f"✅ Stored: OCR ID {ocr_id}", flush=True)
                
            except Exception as db_error:
                print(f"❌ Database error: {db_error}", flush=True)
                import traceback
                traceback.print_exc()
                raise Exception(f"Database error: {str(db_error)}")
            
            preview = extracted_text[:500] + '...' if len(extracted_text) > 500 else extracted_text
            
            print("✅ Upload complete", flush=True)
            print("=" * 60, flush=True)
            
            return jsonify({
                'success': True,
                'ocr_id': ocr_id,
                'extracted_text': preview,
                'full_text': extracted_text
            }), 200
        
        except Exception as e:
            print(f"❌ Processing error: {e}", flush=True)
            import traceback
            traceback.print_exc()
            return jsonify({'error': str(e)}), 500
        
        finally:
            if filepath and os.path.exists(filepath):
                try:
                    os.remove(filepath)
                    print(f"✅ Temp file deleted", flush=True)
                except:
                    pass
    
    except Exception as e:
        print(f"❌ Request error: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/manual-schema', methods=['POST'])
def manual_schema():
    """Handle manual schema text input"""
    print("=" * 60, flush=True)
    print("📝 Manual schema request", flush=True)
    
    try:
        if not _db_initialized:
            init_db()
        
        data = request.get_json()
        if not data or not data.get('schema_text'):
            return jsonify({'error': 'Missing schema text'}), 400
        
        schema_text = data['schema_text'].strip()
        
        if not schema_text:
            return jsonify({'error': 'Empty schema text'}), 400
        
        print(f"📄 Schema text: {len(schema_text)} chars", flush=True)
        
        try:
            conn = get_sqlite_connection()
            cursor = conn.cursor()
            
            cursor.execute(
                "INSERT INTO ocr_results (filename, extracted_text, created_at) VALUES (?, ?, ?)",
                ('manual_input.txt', schema_text, datetime.now().isoformat())
            )
            
            ocr_id = cursor.lastrowid
            conn.commit()
            
            print(f"✅ Stored: OCR ID {ocr_id}", flush=True)
            print("=" * 60, flush=True)
            
            return jsonify({
                'success': True,
                'ocr_id': ocr_id,
                'extracted_text': schema_text[:500] + '...' if len(schema_text) > 500 else schema_text
            }), 200
        
        except Exception as db_error:
            print(f"❌ Database error: {db_error}", flush=True)
            import traceback
            traceback.print_exc()
            return jsonify({'error': f"Database error: {str(db_error)}"}), 500
    
    except Exception as e:
        print(f"❌ Request error: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/generate', methods=['POST'])
def generate_model():
    """Generate Data Vault model"""
    print("=" * 60, flush=True)
    print("🧠 Generate request", flush=True)
    
    try:
        if not _db_initialized:
            init_db()
        
        data = request.get_json()
        if not data or not data.get('ocr_id'):
            return jsonify({'error': 'Missing ocr_id'}), 400
        
        ocr_id = data['ocr_id']
        grounded = data.get('grounded', False)
        
        try:
            conn = get_sqlite_connection()
            cursor = conn.cursor()
            
            # Get OCR text
            cursor.execute("SELECT extracted_text FROM ocr_results WHERE id = ?", (ocr_id,))
            result = cursor.fetchone()
            
            if not result:
                return jsonify({'error': 'OCR result not found'}), 404
            
            ocr_text = result['extracted_text']
            print(f"✅ OCR loaded: {len(ocr_text)} chars", flush=True)
            
            # Get knowledge if grounded
            knowledge = ''
            if grounded:
                cursor.execute("SELECT content FROM knowledge_docs ORDER BY uploaded_at DESC LIMIT 1")
                k = cursor.fetchone()
                if k:
                    knowledge = k['content']
            
            # Generate model
            model = generate_dv_model(ocr_text, grounded, knowledge)
            
            # Store model
            cursor.execute(
                "INSERT INTO dv_models (ocr_id, model_json, grounded, created_at) VALUES (?, ?, ?, ?)",
                (ocr_id, json.dumps(model), 1 if grounded else 0, datetime.now().isoformat())
            )
            
            model_id = cursor.lastrowid
            conn.commit()
            
            print(f"✅ Model stored: ID {model_id}", flush=True)
            print("=" * 60, flush=True)
            
            return jsonify({
                'success': True,
                'model_id': model_id,
                'model': model
            }), 200
        
        except Exception as e:
            print(f"❌ Generation error: {e}", flush=True)
            import traceback
            traceback.print_exc()
            return jsonify({'error': str(e)}), 500
    
    except Exception as e:
        print(f"❌ Request error: {e}", flush=True)
        return jsonify({'error': str(e)}), 500

@app.route('/api/knowledge/upload', methods=['POST'])
def upload_knowledge():
    """Upload methodology doc"""
    try:
        if not _db_initialized:
            init_db()
        
        if 'file' not in request.files:
            return jsonify({'error': 'No file'}), 400
        
        file = request.files['file']
        filename = secure_filename(file.filename)
        content = file.read().decode('utf-8', errors='replace')
        
        conn = get_sqlite_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            "INSERT INTO knowledge_docs (name, content, uploaded_at) VALUES (?, ?, ?)",
            (filename, content, datetime.now().isoformat())
        )
        
        conn.commit()
        
        return jsonify({'success': True, 'message': 'Uploaded'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/models', methods=['GET'])
def get_models():
    """Get all models"""
    try:
        if not _db_initialized:
            init_db()
        
        conn = get_sqlite_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT m.id, m.ocr_id, o.filename, m.grounded, m.created_at
            FROM dv_models m
            JOIN ocr_results o ON m.ocr_id = o.id
            ORDER BY m.created_at DESC
        """)
        
        results = cursor.fetchall()
        
        models = [{
            'id': r['id'],
            'ocr_id': r['ocr_id'],
            'filename': r['filename'],
            'grounded': bool(r['grounded']),
            'created_at': str(r['created_at'])
        } for r in results]
        
        return jsonify({'models': models}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/models/<int:model_id>', methods=['GET'])
def get_model(model_id):
    """Get specific model"""
    try:
        if not _db_initialized:
            init_db()
        
        conn = get_sqlite_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT model_json FROM dv_models WHERE id = ?", (model_id,))
        result = cursor.fetchone()
        
        if not result:
            return jsonify({'error': 'Not found'}), 404
        
        return jsonify({
            'success': True,
            'model': json.loads(result['model_json'])
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.errorhandler(Exception)
def handle_error(error):
    """Global error handler"""
    print(f"❌ Unhandled: {error}", flush=True)
    import traceback
    traceback.print_exc()
    return jsonify({'error': 'Server error', 'details': str(error)}), 500

if __name__ == '__main__':
    try:
        print("🚀 Starting...", flush=True)
        init_db()
        app.run(debug=True, host='0.0.0.0', port=5000)
    except Exception as e:
        print(f"❌ Startup error: {e}", flush=True)
        raise
else:
    print("🚀 App loaded (gunicorn)", flush=True)
    print(f"🔧 Database: SQLite", flush=True)
