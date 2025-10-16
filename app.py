import os
import json
import duckdb
from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename
import requests
from datetime import datetime

app = Flask(__name__)

# Configure paths for Render deployment
if os.getenv('RENDER'):
    # Render uses /opt/render/project/src as the base path
    BASE_PATH = '/opt/render/project/src'
    app.config['UPLOAD_FOLDER'] = os.path.join(BASE_PATH, 'uploads')
    DB_PATH = os.path.join(BASE_PATH, 'db', 'datavault.duckdb')
else:
    # Local development
    app.config['UPLOAD_FOLDER'] = 'uploads'
    DB_PATH = 'db/datavault.duckdb'

app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['ALLOWED_EXTENSIONS'] = {'png', 'jpg', 'jpeg', 'pdf', 'gif'}

# Ensure directories exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
if not os.getenv('RENDER'):
    os.makedirs('knowledge', exist_ok=True)

# Environment variables
OCR_API_KEY = os.getenv('OCR_SPACE_KEY', '')
GROQ_API_KEY = os.getenv('GROQ_API_KEY', '')

def init_db():
    """Initialize DuckDB database with required tables"""
    try:
        conn = duckdb.connect(DB_PATH)
        
        # Create tables with auto-increment IDs
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ocr_results (
                id INTEGER PRIMARY KEY,
                filename TEXT,
                extracted_text TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dv_models (
                id INTEGER PRIMARY KEY,
                ocr_id INTEGER,
                model_json TEXT,
                grounded BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (ocr_id) REFERENCES ocr_results(id)
            )
        """)
        
        conn.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_docs (
                id INTEGER PRIMARY KEY,
                name TEXT,
                content TEXT,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        conn.close()
        print(f"✅ Database initialized at {DB_PATH}")
    except Exception as e:
        print(f"❌ Database initialization error: {e}")
        raise

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def extract_text_ocr(filepath):
    """Extract text from image using OCR.space API"""
    if not OCR_API_KEY:
        raise ValueError("OCR_SPACE_KEY not configured")
    
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
    
    result = response.json()
    
    if result.get('IsErroredOnProcessing'):
        raise Exception(result.get('ErrorMessage', 'OCR processing failed'))
    
    parsed_text = result['ParsedResults'][0]['ParsedText']
    return parsed_text

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
    
    result = response.json()
    
    if 'error' in result:
        raise Exception(result['error'].get('message', 'GROQ API error'))
    
    content = result['choices'][0]['message']['content'].strip()
    
    # Clean markdown formatting if present
    content = content.replace('```json', '').replace('```', '').strip()
    
    model = json.loads(content)
    return model

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
        return jsonify({'error': 'Invalid file type'}), 400
    
    filepath = None
    conn = None
    
    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # Extract text via OCR
        extracted_text = extract_text_ocr(filepath)
        
        # Store in DuckDB
        conn = duckdb.connect(DB_PATH)
        
        # Insert and get the auto-generated ID
        conn.execute("""
            INSERT INTO ocr_results (filename, extracted_text, created_at)
            VALUES (?, ?, ?)
        """, [filename, extracted_text, datetime.now()])
        
        # Get the last inserted ID
        ocr_id = conn.execute("SELECT MAX(id) FROM ocr_results").fetchone()[0]
        
        return jsonify({
            'success': True,
            'ocr_id': ocr_id,
            'extracted_text': extracted_text[:500] + '...' if len(extracted_text) > 500 else extracted_text
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    finally:
        # Clean up
        if conn:
            conn.close()
        if filepath and os.path.exists(filepath):
            try:
                os.remove(filepath)
            except:
                pass

@app.route('/api/generate', methods=['POST'])
def generate_model():
    """Generate Data Vault model from OCR text"""
    data = request.json
    ocr_id = data.get('ocr_id')
    grounded = data.get('grounded', False)
    
    if not ocr_id:
        return jsonify({'error': 'OCR ID required'}), 400
    
    conn = None
    
    try:
        conn = duckdb.connect(DB_PATH)
        
        # Get OCR text
        result = conn.execute(
            "SELECT extracted_text FROM ocr_results WHERE id = ?",
            [ocr_id]
        ).fetchone()
        
        if not result:
            return jsonify({'error': 'OCR result not found'}), 404
        
        ocr_text = result[0]
        
        # Get knowledge doc if grounded mode
        knowledge_content = ''
        if grounded:
            knowledge = conn.execute(
                "SELECT content FROM knowledge_docs ORDER BY uploaded_at DESC LIMIT 1"
            ).fetchone()
            if knowledge:
                knowledge_content = knowledge[0]
        
        # Generate model
        model = generate_dv_model(ocr_text, grounded, knowledge_content)
        
        # Insert and get auto-generated ID
        conn.execute("""
            INSERT INTO dv_models (ocr_id, model_json, grounded, created_at)
            VALUES (?, ?, ?, ?)
        """, [ocr_id, json.dumps(model), grounded, datetime.now()])
        
        # Get the last inserted ID
        model_id = conn.execute("SELECT MAX(id) FROM dv_models").fetchone()[0]
        
        return jsonify({
            'success': True,
            'model': model
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    finally:
        if conn:
            conn.close()

@app.route('/api/knowledge/upload', methods=['POST'])
def upload_knowledge():
    """Upload DV2.1 methodology document"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    conn = None
    
    try:
        filename = secure_filename(file.filename)
        content = file.read().decode('utf-8')
        
        conn = duckdb.connect(DB_PATH)
        
        # Insert and get auto-generated ID
        conn.execute("""
            INSERT INTO knowledge_docs (name, content, uploaded_at)
            VALUES (?, ?, ?)
        """, [filename, content, datetime.now()])
        
        return jsonify({'success': True, 'message': 'Knowledge document uploaded'})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    finally:
        if conn:
            conn.close()

@app.route('/api/models', methods=['GET'])
def get_models():
    """Get all generated models"""
    conn = None
    
    try:
        conn = duckdb.connect(DB_PATH)
        results = conn.execute("""
            SELECT m.id, m.ocr_id, o.filename, m.grounded, m.created_at
            FROM dv_models m
            JOIN ocr_results o ON m.ocr_id = o.id
            ORDER BY m.created_at DESC
        """).fetchall()
        
        models = [{
            'id': r[0],
            'ocr_id': r[1],
            'filename': r[2],
            'grounded': r[3],
            'created_at': str(r[4])
        } for r in results]
        
        return jsonify({'models': models})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    finally:
        if conn:
            conn.close()

@app.route('/api/models/<int:model_id>', methods=['GET'])
def get_model(model_id):
    """Get specific model by ID"""
    conn = None
    
    try:
        conn = duckdb.connect(DB_PATH)
        result = conn.execute(
            "SELECT model_json FROM dv_models WHERE id = ?",
            [model_id]
        ).fetchone()
        
        if not result:
            return jsonify({'error': 'Model not found'}), 404
        
        return jsonify({
            'success': True,
            'model': json.loads(result[0])
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    init_db()
    app.run(debug=True, host='0.0.0.0', port=5000)
else:
    # When running with gunicorn on Render
    init_db()
