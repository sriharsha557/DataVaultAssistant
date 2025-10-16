import os
import json
from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename
import requests
from datetime import datetime

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

def get_db_connection():
    """Get database connection - Turso or local SQLite"""
    if TURSO_URL and TURSO_TOKEN:
        # Use Turso (libSQL) for production
        try:
            import libsql_experimental as libsql
            return libsql.connect(database=TURSO_URL, auth_token=TURSO_TOKEN)
        except ImportError:
            print("⚠️ libsql_experimental not installed, falling back to local SQLite")
            import sqlite3
            os.makedirs('db', exist_ok=True)
            return sqlite3.connect('db/datavault.db')
    else:
        # Use local SQLite for development
        import sqlite3
        os.makedirs('db', exist_ok=True)
        return sqlite3.connect('db/datavault.db')

def init_db():
    """Initialize database with required tables"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Create tables with auto-increment IDs
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS ocr_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT,
                extracted_text TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS dv_models (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ocr_id INTEGER,
                model_json TEXT,
                grounded INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (ocr_id) REFERENCES ocr_results(id)
            )
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_docs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                content TEXT,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        conn.commit()
        conn.close()
        
        if TURSO_URL and TURSO_TOKEN:
            print("✅ Database initialized on Turso (persistent)")
        else:
            print("✅ Database initialized locally (ephemeral)")
    except Exception as e:
        print(f"❌ Database initialization error: {e}")
        raise

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def extract_text_ocr(filepath):
    """Extract text from image using OCR.space API"""
    if not OCR_API_KEY:
        raise ValueError("OCR_SPACE_KEY not configured")
    
    try:
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
                timeout=60
            )
        
        response.raise_for_status()  # Raise exception for HTTP errors
        result = response.json()
        
        if result.get('IsErroredOnProcessing'):
            raise Exception(result.get('ErrorMessage', 'OCR processing failed'))
        
        if not result.get('ParsedResults') or len(result['ParsedResults']) == 0:
            raise Exception('No OCR results returned')
        
        parsed_text = result['ParsedResults'][0].get('ParsedText', '')
        if not parsed_text:
            raise Exception('OCR extracted empty text - try a clearer image')
        
        return parsed_text
    
    except requests.exceptions.RequestException as e:
        raise Exception(f"OCR API request failed: {str(e)}")
    except Exception as e:
        raise Exception(f"OCR extraction error: {str(e)}")

def generate_dv_model(ocr_text, grounded=False, knowledge_content=''):
    """Generate Data Vault 2.1 model using GROQ API"""
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY not configured")
    
    # Build prompt
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
{ocr_text}
>>>

Instructions:
1. Identify all tables and their columns
2. Create Hubs for business entities (tables with natural business keys)
3. Create Links for relationships between Hubs
4. Create Satellites for descriptive attributes
5. Follow Data Vault 2.1 naming: Hub_EntityName, Link_Entity1_Entity2, Sat_EntityName_Context
6. Add proper hash keys and load timestamps

Return ONLY valid JSON (no markdown formatting) in this exact structure:
{{
  "nodes": [
    {{"id": "Hub_Customer", "type": "hub", "businessKey": "customer_id", "sourceTable": "customer", "attributes": ["customer_id"]}},
    {{"id": "Sat_Customer_Details", "type": "satellite", "parent": "Hub_Customer", "attributes": ["first_name", "last_name", "email"], "sourceTable": "customer"}},
    {{"id": "Link_Customer_Order", "type": "link", "connects": ["Hub_Customer", "Hub_Order"], "sourceRelationship": "fk_customer_order"}}
  ],
  "edges": [
    {{"from": "Hub_Customer", "to": "Sat_Customer_Details"}},
    {{"from": "Hub_Customer", "to": "Link_Customer_Order"}},
    {{"from": "Hub_Order", "to": "Link_Customer_Order"}}
  ]
}}"""
    
    try:
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
                'temperature': 0.2,
                'max_tokens': 4000
            },
            timeout=60
        )
        
        response.raise_for_status()
        result = response.json()
        
        if 'error' in result:
            error_msg = result['error'].get('message', 'Unknown GROQ error')
            raise Exception(f"GROQ API error: {error_msg}")
        
        if not result.get('choices') or len(result['choices']) == 0:
            raise Exception('No response from GROQ API')
        
        content = result['choices'][0]['message']['content'].strip()
        
        # Clean markdown formatting if present
        content = content.replace('```json', '').replace('```', '').strip()
        
        model = json.loads(content)
        
        # Validate model structure
        if not isinstance(model, dict) or 'nodes' not in model:
            raise Exception('Invalid model structure - missing "nodes" field')
        
        return model
    
    except requests.exceptions.RequestException as e:
        raise Exception(f"GROQ API request failed: {str(e)}")
    except json.JSONDecodeError as e:
        raise Exception(f"Failed to parse GROQ response as JSON: {str(e)}")
    except Exception as e:
        raise Exception(f"Model generation error: {str(e)}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/config/check', methods=['GET'])
def check_config():
    """Check if API keys are configured"""
    return jsonify({
        'ocr_configured': bool(OCR_API_KEY),
        'groq_configured': bool(GROQ_API_KEY)
    })

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Handle file upload and OCR extraction"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Allowed: PNG, JPG, JPEG, PDF, GIF'}), 400
    
    filepath = None
    conn = None
    
    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # Extract text via OCR
        extracted_text = extract_text_ocr(filepath)
        
        # Store in database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO ocr_results (filename, extracted_text, created_at)
            VALUES (?, ?, ?)
        """, (filename, extracted_text, datetime.now().isoformat()))
        
        # Get the last inserted ID
        ocr_id = cursor.lastrowid
        
        conn.commit()
        
        preview = extracted_text[:500] + '...' if len(extracted_text) > 500 else extracted_text
        
        return jsonify({
            'success': True,
            'ocr_id': ocr_id,
            'extracted_text': preview
        }), 200
    
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Upload error: {error_msg}")
        return jsonify({'error': error_msg}), 500
    
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass
        if filepath and os.path.exists(filepath):
            try:
                os.remove(filepath)
            except:
                pass

@app.route('/api/generate', methods=['POST'])
def generate_model():
    """Generate Data Vault model from OCR text"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        ocr_id = data.get('ocr_id')
        grounded = data.get('grounded', False)
        
        if not ocr_id:
            return jsonify({'error': 'OCR ID required'}), 400
        
        conn = None
        
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Get OCR text
            cursor.execute("SELECT extracted_text FROM ocr_results WHERE id = ?", (ocr_id,))
            result = cursor.fetchone()
            
            if not result:
                return jsonify({'error': 'OCR result not found'}), 404
            
            ocr_text = result[0]
            
            # Get knowledge doc if grounded mode
            knowledge_content = ''
            if grounded:
                cursor.execute("SELECT content FROM knowledge_docs ORDER BY uploaded_at DESC LIMIT 1")
                knowledge = cursor.fetchone()
                if knowledge:
                    knowledge_content = knowledge[0]
            
            # Generate model
            model = generate_dv_model(ocr_text, grounded, knowledge_content)
            
            # Insert model
            cursor.execute("""
                INSERT INTO dv_models (ocr_id, model_json, grounded, created_at)
                VALUES (?, ?, ?, ?)
            """, (ocr_id, json.dumps(model), 1 if grounded else 0, datetime.now().isoformat()))
            
            model_id = cursor.lastrowid
            conn.commit()
            
            return jsonify({
                'success': True,
                'model_id': model_id,
                'model': model
            }), 200
        
        finally:
            if conn:
                try:
                    conn.close()
                except:
                    pass
    
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Generate error: {error_msg}")
        return jsonify({'error': error_msg}), 500

@app.route('/api/knowledge/upload', methods=['POST'])
def upload_knowledge():
    """Upload DV2.1 methodology document"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    conn = None
    
    try:
        filename = secure_filename(file.filename)
        content = file.read().decode('utf-8', errors='replace')
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO knowledge_docs (name, content, uploaded_at)
            VALUES (?, ?, ?)
        """, (filename, content, datetime.now().isoformat()))
        
        conn.commit()
        
        return jsonify({'success': True, 'message': 'Knowledge document uploaded'}), 200
    
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Knowledge upload error: {error_msg}")
        return jsonify({'error': error_msg}), 500
    
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

@app.route('/api/models', methods=['GET'])
def get_models():
    """Get all generated models"""
    conn = None
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT m.id, m.ocr_id, o.filename, m.grounded, m.created_at
            FROM dv_models m
            JOIN ocr_results o ON m.ocr_id = o.id
            ORDER BY m.created_at DESC
        """)
        
        results = cursor.fetchall()
        
        models = [{
            'id': r[0],
            'ocr_id': r[1],
            'filename': r[2],
            'grounded': bool(r[3]),
            'created_at': str(r[4])
        } for r in results]
        
        return jsonify({'models': models}), 200
    
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Get models error: {error_msg}")
        return jsonify({'error': error_msg}), 500
    
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

@app.route('/api/models/<int:model_id>', methods=['GET'])
def get_model(model_id):
    """Get specific model by ID"""
    conn = None
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT model_json FROM dv_models WHERE id = ?", (model_id,))
        result = cursor.fetchone()
        
        if not result:
            return jsonify({'error': 'Model not found'}), 404
        
        return jsonify({
            'success': True,
            'model': json.loads(result[0])
        }), 200
    
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Get model error: {error_msg}")
        return jsonify({'error': error_msg}), 500
    
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

if __name__ == '__main__':
    init_db()
    app.run(debug=True, host='0.0.0.0', port=5000)
else:
    # When running with gunicorn (on Render)
    init_db()
