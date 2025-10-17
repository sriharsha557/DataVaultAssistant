import os
import json
import threading
from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename
import requests
from datetime import datetime
from contextlib import contextmanager
import sys

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['ALLOWED_EXTENSIONS'] = {'png', 'jpg', 'jpeg', 'pdf', 'gif'}

# Ensure upload folder exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Environment variables
OCR_API_KEY = os.getenv('OCR_SPACE_KEY', '')
GROQ_API_KEY = os.getenv('GROQ_API_KEY', '')
TURSO_URL = os.getenv('TURSO_DATABASE_URL', '')
TURSO_TOKEN = os.getenv('TURSO_AUTH_TOKEN', '')

# Determine database mode
USE_TURSO = bool(TURSO_URL and TURSO_TOKEN)

# Thread-local storage for connections
_local = threading.local()
_db_initialized = False
_db_init_lock = threading.Lock()

print(f"🔧 Database mode: {'Turso' if USE_TURSO else 'SQLite (local)'}", flush=True)
print(f"🔑 OCR configured: {bool(OCR_API_KEY)}", flush=True)
print(f"🔑 GROQ configured: {bool(GROQ_API_KEY)}", flush=True)

@contextmanager
def get_db_connection():
    """Get database connection - Turso or SQLite with proper thread safety"""
    conn = None
    
    try:
        if USE_TURSO:
            # Use Turso (libsql) for production
            try:
                import libsql_experimental as libsql
                
                if not hasattr(_local, 'turso_conn') or _local.turso_conn is None:
                    _local.turso_conn = libsql.connect(
                        database=TURSO_URL,
                        auth_token=TURSO_TOKEN
                    )
                    print("✅ Turso connection established", flush=True)
                
                conn = _local.turso_conn
                
            except ImportError:
                print("⚠️ libsql_experimental not installed, falling back to SQLite", flush=True)
                conn = _get_sqlite_connection()
            except Exception as e:
                print(f"⚠️ Turso connection error: {e}, falling back to SQLite", flush=True)
                conn = _get_sqlite_connection()
        else:
            # Use SQLite for local development
            conn = _get_sqlite_connection()
        
        yield conn
        
    except Exception as e:
        print(f"❌ Database connection error: {e}", flush=True)
        raise
    finally:
        # Don't close connection - reuse it for thread lifetime
        pass

def _get_sqlite_connection():
    """Thread-safe SQLite connection"""
    import sqlite3
    
    if not hasattr(_local, 'sqlite_conn') or _local.sqlite_conn is None:
        try:
            os.makedirs('db', exist_ok=True)
            _local.sqlite_conn = sqlite3.connect(
                'db/datavault.db',
                timeout=30.0,
                check_same_thread=False,
                isolation_level='DEFERRED'
            )
            _local.sqlite_conn.row_factory = sqlite3.Row
            # Enable WAL mode for better concurrency
            _local.sqlite_conn.execute('PRAGMA journal_mode=WAL')
            _local.sqlite_conn.execute('PRAGMA busy_timeout=30000')
            print("✅ SQLite connection established", flush=True)
        except Exception as e:
            print(f"❌ SQLite connection error: {e}", flush=True)
            raise
    
    return _local.sqlite_conn

def init_db():
    """Initialize database with required tables - lazy initialization"""
    global _db_initialized
    
    # Check if already initialized
    if _db_initialized:
        return True
    
    with _db_init_lock:
        # Double-check after acquiring lock
        if _db_initialized:
            return True
        
        try:
            print("🔄 Initializing database...", flush=True)
            
            with get_db_connection() as conn:
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
                
                # Create indexes for performance
                try:
                    cursor.execute("""
                        CREATE INDEX IF NOT EXISTS idx_ocr_created 
                        ON ocr_results(created_at DESC)
                    """)
                    
                    cursor.execute("""
                        CREATE INDEX IF NOT EXISTS idx_models_ocr 
                        ON dv_models(ocr_id)
                    """)
                except Exception as idx_error:
                    print(f"⚠️ Index creation warning: {idx_error}", flush=True)
                
                conn.commit()
                print("✅ Database initialized successfully", flush=True)
                _db_initialized = True
                return True
                
        except Exception as e:
            print(f"❌ Database initialization error: {e}", flush=True)
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
        print(f"📤 Sending file to OCR.space API...", flush=True)
        
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
                timeout=150  # Increased timeout for large images
            )
        
        print(f"📥 OCR API response status: {response.status_code}", flush=True)
        response.raise_for_status()
        result = response.json()
        
        if result.get('IsErroredOnProcessing'):
            error_msg = result.get('ErrorMessage', 'OCR processing failed')
            print(f"❌ OCR API error: {error_msg}", flush=True)
            raise Exception(error_msg)
        
        if not result.get('ParsedResults') or len(result['ParsedResults']) == 0:
            print(f"❌ No OCR results returned", flush=True)
            raise Exception('No OCR results returned')
        
        parsed_text = result['ParsedResults'][0].get('ParsedText', '')
        if not parsed_text:
            print(f"❌ OCR extracted empty text", flush=True)
            raise Exception('OCR extracted empty text - try a clearer image')
        
        print(f"✅ OCR extracted {len(parsed_text)} characters", flush=True)
        return parsed_text
    
    except requests.exceptions.Timeout:
        print(f"❌ OCR API timeout", flush=True)
        raise Exception("OCR API request timed out - try a smaller image")
    except requests.exceptions.RequestException as e:
        print(f"❌ OCR API request error: {str(e)}", flush=True)
        raise Exception(f"OCR API request failed: {str(e)}")
    except Exception as e:
        print(f"❌ OCR extraction error: {str(e)}", flush=True)
        raise Exception(f"OCR extraction error: {str(e)}")

def validate_dv_model(model):
    """Validate Data Vault model structure and consistency"""
    if not isinstance(model, dict):
        raise ValueError("Model must be a dictionary")
    
    if 'nodes' not in model or not isinstance(model['nodes'], list):
        raise ValueError("Model must have 'nodes' array")
    
    if len(model['nodes']) == 0:
        raise ValueError("Model must have at least one node")
    
    # Collect all node IDs
    node_ids = set()
    for node in model['nodes']:
        if 'id' not in node or not node['id']:
            raise ValueError("All nodes must have an 'id' field")
        if 'type' not in node:
            raise ValueError(f"Node {node['id']} missing 'type' field")
        node_ids.add(node['id'])
    
    # Validate edges if present
    if 'edges' in model and isinstance(model['edges'], list):
        for idx, edge in enumerate(model['edges']):
            source = edge.get('from') or edge.get('source')
            target = edge.get('to') or edge.get('target')
            
            if not source or not target:
                print(f"⚠️ Edge {idx} missing source or target", flush=True)
                continue
            
            if source not in node_ids:
                print(f"⚠️ Edge {idx} references non-existent source: {source}", flush=True)
                continue
            
            if target not in node_ids:
                print(f"⚠️ Edge {idx} references non-existent target: {target}", flush=True)
                continue
    
    # Validate parent references for satellites
    for node in model['nodes']:
        if node.get('type') == 'satellite' and node.get('parent'):
            if node['parent'] not in node_ids:
                print(f"⚠️ Satellite {node['id']} references non-existent parent: {node['parent']}", flush=True)
    
    return True

def generate_dv_model(ocr_text, grounded=False, knowledge_content=''):
    """Generate Data Vault 2.1 model using GROQ API with enhanced validation"""
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY not configured")
    
    # Build system prompt
    if grounded and knowledge_content:
        system_prompt = f"""You are an expert Data Vault 2.1 modeler.
Using the following DV2.1 methodology guidelines:
<<<
{knowledge_content[:3000]}
>>>

Follow these guidelines strictly when creating the model."""
    else:
        system_prompt = "You are an expert Data Vault 2.1 modeler. Follow standard Data Vault 2.1 best practices."
    
    user_prompt = f"""Convert the following source database schema into a Data Vault 2.1 model.

Source Schema (extracted from ERD):
<<<
{ocr_text[:4000]}
>>>

CRITICAL INSTRUCTIONS:
1. Identify all tables and their columns carefully
2. Create Hubs for business entities (tables with natural business keys)
3. Create Links for relationships between Hubs
4. Create Satellites for descriptive attributes
5. Follow Data Vault 2.1 naming: Hub_EntityName, Link_Entity1_Entity2, Sat_EntityName_Context
6. Add proper hash keys and load timestamps
7. IMPORTANT: For EVERY satellite, you MUST create an edge connecting it to its parent hub
8. IMPORTANT: For EVERY link, you MUST create edges connecting it to ALL hubs it relates

Return ONLY valid JSON (no markdown, no code blocks, no backticks) in this EXACT structure:
{{
  "nodes": [
    {{"id": "Hub_Customer", "type": "hub", "businessKey": "customer_id", "sourceTable": "customer", "attributes": ["customer_id"]}},
    {{"id": "Sat_Customer_Details", "type": "satellite", "parent": "Hub_Customer", "attributes": ["first_name", "last_name", "email"], "sourceTable": "customer"}},
    {{"id": "Hub_Order", "type": "hub", "businessKey": "order_id", "sourceTable": "order", "attributes": ["order_id"]}},
    {{"id": "Link_Customer_Order", "type": "link", "connects": ["Hub_Customer", "Hub_Order"], "sourceRelationship": "customer places order"}}
  ],
  "edges": [
    {{"from": "Hub_Customer", "to": "Sat_Customer_Details"}},
    {{"from": "Hub_Customer", "to": "Link_Customer_Order"}},
    {{"from": "Hub_Order", "to": "Link_Customer_Order"}}
  ]
}}

VALIDATION RULES:
- Every satellite MUST have a corresponding edge in the edges array
- Every link MUST have edges connecting to all hubs in its "connects" array
- All edge "from" and "to" values MUST exactly match node "id" values
- Use ONLY "from" and "to" in edges (not "source" and "target")

Your response must be ONLY the JSON object, nothing else."""
    
    try:
        print(f"🤖 Sending request to GROQ API...", flush=True)
        
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
                'max_tokens': 4000
            },
            timeout=90  # Increased timeout
        )
        
        print(f"📥 GROQ API response status: {response.status_code}", flush=True)
        response.raise_for_status()
        result = response.json()
        
        if 'error' in result:
            error_msg = result['error'].get('message', 'Unknown GROQ error')
            print(f"❌ GROQ API error: {error_msg}", flush=True)
            raise Exception(f"GROQ API error: {error_msg}")
        
        if not result.get('choices') or len(result['choices']) == 0:
            print(f"❌ No response from GROQ API", flush=True)
            raise Exception('No response from GROQ API')
        
        content = result['choices'][0]['message']['content'].strip()
        print(f"📄 GROQ response length: {len(content)} chars", flush=True)
        
        # Clean markdown formatting if present
        content = content.replace('```json', '').replace('```', '').strip()
        
        # Parse JSON
        model = json.loads(content)
        print(f"✅ JSON parsed successfully", flush=True)
        
        # Validate model structure
        validate_dv_model(model)
        print(f"✅ Model validated", flush=True)
        
        # Ensure edges array exists
        if 'edges' not in model:
            model['edges'] = []
        
        # Auto-generate missing satellite edges
        node_lookup = {node['id']: node for node in model['nodes']}
        existing_edges = {(e.get('from'), e.get('to')) for e in model['edges']}
        
        auto_edges = 0
        for node in model['nodes']:
            if node['type'] == 'satellite' and node.get('parent'):
                parent_id = node['parent']
                if (parent_id, node['id']) not in existing_edges:
                    model['edges'].append({
                        'from': parent_id,
                        'to': node['id']
                    })
                    auto_edges += 1
            
            elif node['type'] == 'link' and node.get('connects'):
                for hub_id in node['connects']:
                    if (hub_id, node['id']) not in existing_edges:
                        model['edges'].append({
                            'from': hub_id,
                            'to': node['id']
                        })
                        auto_edges += 1
        
        if auto_edges > 0:
            print(f"✅ Auto-created {auto_edges} missing edges", flush=True)
        
        print(f"✅ Final model: {len(model['nodes'])} nodes, {len(model['edges'])} edges", flush=True)
        return model
    
    except requests.exceptions.Timeout:
        print(f"❌ GROQ API timeout", flush=True)
        raise Exception("GROQ API request timed out")
    except requests.exceptions.RequestException as e:
        print(f"❌ GROQ API request error: {str(e)}", flush=True)
        raise Exception(f"GROQ API request failed: {str(e)}")
    except json.JSONDecodeError as e:
        print(f"❌ JSON parse error: {str(e)}", flush=True)
        raise Exception(f"Failed to parse GROQ response as JSON: {str(e)}")
    except Exception as e:
        print(f"❌ Model generation error: {str(e)}", flush=True)
        raise Exception(f"Model generation error: {str(e)}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/config/check', methods=['GET'])
def check_config():
    """Check if API keys are configured and database is ready"""
    try:
        # Ensure database is initialized
        if not _db_initialized:
            init_db()
        
        return jsonify({
            'ocr_configured': bool(OCR_API_KEY),
            'groq_configured': bool(GROQ_API_KEY),
            'database': 'Turso' if USE_TURSO else 'SQLite',
            'database_ready': _db_initialized
        }), 200
    except Exception as e:
        print(f"❌ Config check error: {str(e)}", flush=True)
        return jsonify({
            'ocr_configured': bool(OCR_API_KEY),
            'groq_configured': bool(GROQ_API_KEY),
            'database': 'Error',
            'database_ready': False,
            'error': str(e)
        }), 500

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Handle file upload and OCR extraction"""
    print("=" * 60, flush=True)
    print("📤 Upload request received", flush=True)
    
    try:
        # Ensure database is ready
        if not _db_initialized:
            init_db()
        
        if 'file' not in request.files:
            print("❌ No file in request", flush=True)
            return jsonify({'error': 'No file uploaded'}), 400
        
        file = request.files['file']
        print(f"📄 File: {file.filename}", flush=True)
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file type. Allowed: PNG, JPG, JPEG, PDF, GIF'}), 400
        
        filepath = None
        
        try:
            filename = secure_filename(file.filename)
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            print(f"✅ File saved: {filepath}", flush=True)
            
            # Extract text via OCR
            extracted_text = extract_text_ocr(filepath)
            
            # Store in database
            with get_db_connection() as conn:
                cursor = conn.cursor()
                
                cursor.execute("""
                    INSERT INTO ocr_results (filename, extracted_text, created_at)
                    VALUES (?, ?, ?)
                """, (filename, extracted_text, datetime.now().isoformat()))
                
                if USE_TURSO:
                    ocr_id = cursor.lastrowid
                else:
                    ocr_id = cursor.lastrowid
                
                conn.commit()
                print(f"✅ Stored with OCR ID: {ocr_id}", flush=True)
            
            preview = extracted_text[:500] + '...' if len(extracted_text) > 500 else extracted_text
            
            print("✅ Upload successful", flush=True)
            print("=" * 60, flush=True)
            
            return jsonify({
                'success': True,
                'ocr_id': ocr_id,
                'extracted_text': preview
            }), 200
        
        except Exception as e:
            error_msg = str(e)
            print(f"❌ Processing error: {error_msg}", flush=True)
            import traceback
            traceback.print_exc()
            return jsonify({'error': error_msg}), 500
        
        finally:
            if filepath and os.path.exists(filepath):
                try:
                    os.remove(filepath)
                    print(f"✅ Temp file deleted", flush=True)
                except Exception as e:
                    print(f"⚠️ Could not delete temp file: {e}", flush=True)
    
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Outer exception: {error_msg}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Request processing error: {error_msg}'}), 500

@app.route('/api/generate', methods=['POST'])
def generate_model():
    """Generate Data Vault model from OCR text"""
    print("=" * 60, flush=True)
    print("🧠 Generate request received", flush=True)
    
    try:
        # Ensure database is ready
        if not _db_initialized:
            init_db()
        
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        ocr_id = data.get('ocr_id')
        grounded = data.get('grounded', False)
        print(f"🔍 OCR ID: {ocr_id}, Grounded: {grounded}", flush=True)
        
        if not ocr_id:
            return jsonify({'error': 'OCR ID required'}), 400
        
        try:
            # Get OCR text
            with get_db_connection() as conn:
                cursor = conn.cursor()
                
                cursor.execute("SELECT extracted_text FROM ocr_results WHERE id = ?", (ocr_id,))
                result = cursor.fetchone()
                
                if not result:
                    return jsonify({'error': 'OCR result not found'}), 404
                
                ocr_text = result[0] if isinstance(result, tuple) else result['extracted_text']
                print(f"✅ OCR text loaded: {len(ocr_text)} chars", flush=True)
                
                # Get knowledge doc if grounded mode
                knowledge_content = ''
                if grounded:
                    cursor.execute("SELECT content FROM knowledge_docs ORDER BY uploaded_at DESC LIMIT 1")
                    knowledge = cursor.fetchone()
                    if knowledge:
                        knowledge_content = knowledge[0] if isinstance(knowledge, tuple) else knowledge['content']
                        print(f"✅ Knowledge loaded: {len(knowledge_content)} chars", flush=True)
            
            # Generate model (outside connection to avoid timeout)
            model = generate_dv_model(ocr_text, grounded, knowledge_content)
            
            # Store model
            with get_db_connection() as conn:
                cursor = conn.cursor()
                
                cursor.execute("""
                    INSERT INTO dv_models (ocr_id, model_json, grounded, created_at)
                    VALUES (?, ?, ?, ?)
                """, (ocr_id, json.dumps(model), 1 if grounded else 0, datetime.now().isoformat()))
                
                model_id = cursor.lastrowid
                conn.commit()
                print(f"✅ Model stored: ID {model_id}", flush=True)
            
            print("✅ Generation successful", flush=True)
            print("=" * 60, flush=True)
            
            return jsonify({
                'success': True,
                'model_id': model_id,
                'model': model
            }), 200
        
        except Exception as e:
            error_msg = str(e)
            print(f"❌ Generation error: {error_msg}", flush=True)
            import traceback
            traceback.print_exc()
            return jsonify({'error': error_msg}), 500
    
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Outer exception: {error_msg}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Request processing error: {error_msg}'}), 500

@app.route('/api/knowledge/upload', methods=['POST'])
def upload_knowledge():
    """Upload DV2.1 methodology document"""
    try:
        # Ensure database is ready
        if not _db_initialized:
            init_db()
        
        if 'file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400
        
        file = request.files['file']
        
        filename = secure_filename(file.filename)
        content = file.read().decode('utf-8', errors='replace')
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO knowledge_docs (name, content, uploaded_at)
                VALUES (?, ?, ?)
            """, (filename, content, datetime.now().isoformat()))
            
            conn.commit()
        
        return jsonify({'success': True, 'message': 'Knowledge document uploaded'}), 200
    
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Knowledge upload error: {error_msg}", flush=True)
        return jsonify({'error': error_msg}), 500

@app.route('/api/models', methods=['GET'])
def get_models():
    """Get all generated models"""
    try:
        # Ensure database is ready
        if not _db_initialized:
            init_db()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT m.id, m.ocr_id, o.filename, m.grounded, m.created_at
                FROM dv_models m
                JOIN ocr_results o ON m.ocr_id = o.id
                ORDER BY m.created_at DESC
            """)
            
            results = cursor.fetchall()
            
            models = [{
                'id': r[0] if isinstance(r, tuple) else r['id'],
                'ocr_id': r[1] if isinstance(r, tuple) else r['ocr_id'],
                'filename': r[2] if isinstance(r, tuple) else r['filename'],
                'grounded': bool(r[3] if isinstance(r, tuple) else r['grounded']),
                'created_at': str(r[4] if isinstance(r, tuple) else r['created_at'])
            } for r in results]
            
            return jsonify({'models': models}), 200
    
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Get models error: {error_msg}", flush=True)
        return jsonify({'error': error_msg}), 500

@app.route('/api/models/<int:model_id>', methods=['GET'])
def get_model(model_id):
    """Get specific model by ID"""
    try:
        # Ensure database is ready
        if not _db_initialized:
            init_db()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("SELECT model_json FROM dv_models WHERE id = ?", (model_id,))
            result = cursor.fetchone()
            
            if not result:
                return jsonify({'error': 'Model not found'}), 404
            
            model_json = result[0] if isinstance(result, tuple) else result['model_json']
            
            return jsonify({
                'success': True,
                'model': json.loads(model_json)
            }), 200
    
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Get model error: {error_msg}", flush=True)
        return jsonify({'error': error_msg}), 500

@app.errorhandler(Exception)
def handle_error(error):
    """Global error handler"""
    print(f"❌ Unhandled error: {str(error)}", flush=True)
    import traceback
    traceback.print_exc()
    return jsonify({'error': 'Internal server error', 'details': str(error)}), 500

@app.errorhandler(504)
def handle_timeout(error):
    """Handle gateway timeout"""
    print(f"❌ Gateway timeout", flush=True)
    return jsonify({'error': 'Request timed out. Please try with a smaller image or simpler model.'}), 504

if __name__ == '__main__':
    try:
        print("🚀 Starting application...", flush=True)
        init_db()
        print(f"✅ Database: {'Turso' if USE_TURSO else 'SQLite'}", flush=True)
        app.run(debug=True, host='0.0.0.0', port=5000)
    except Exception as e:
        print(f"❌ Startup error: {str(e)}", flush=True)
        import traceback
        traceback.print_exc()
        raise
else:
    # When running with gunicorn (on Render)
    # Lazy initialization - database will be initialized on first request
    print("🚀 Application loaded (gunicorn mode)", flush=True)
    print(f"🔧 Database: {'Turso' if USE_TURSO else 'SQLite'}", flush=True)
