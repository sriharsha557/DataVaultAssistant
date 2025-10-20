let cy;
let currentOcrId = null;
let currentModel = null;
let fullOcrText = '';

// Initialize Cytoscape with enhanced layout
document.addEventListener('DOMContentLoaded', function() {
    cy = cytoscape({
        container: document.getElementById('cy'),
        
        style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(label)',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'font-size': '12px',
                    'font-weight': '600',
                    'color': 'white',
                    'text-outline-width': 2,
                    'text-outline-color': 'data(borderColor)',
                    'width': 140,
                    'height': 70,
                    'shape': 'roundrectangle',
                    'text-wrap': 'wrap',
                    'text-max-width': '120px'
                }
            },
            {
                selector: 'node[type="hub"]',
                style: {
                    'background-color': '#4a90e2',
                    'border-width': 4,
                    'border-color': '#2c5aa0',
                    'shape': 'roundrectangle'
                }
            },
            {
                selector: 'node[type="link"]',
                style: {
                    'background-color': '#66bb6a',
                    'border-width': 4,
                    'border-color': '#43a047',
                    'shape': 'diamond',
                    'width': 120,
                    'height': 120
                }
            },
            {
                selector: 'node[type="satellite"]',
                style: {
                    'background-color': '#ffa726',
                    'border-width': 4,
                    'border-color': '#f57c00',
                    'shape': 'roundrectangle'
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 3,
                    'line-color': '#999',
                    'target-arrow-color': '#999',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'arrow-scale': 1.5,
                    'opacity': 0.8
                }
            },
            {
                selector: 'node:selected',
                style: {
                    'border-width': 6,
                    'border-color': '#ff4081',
                    'z-index': 999
                }
            },
            {
                selector: 'edge:selected',
                style: {
                    'width': 5,
                    'line-color': '#ff4081',
                    'target-arrow-color': '#ff4081'
                }
            }
        ]
    });

    // Enhanced click handler for nodes with reasoning
    cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        const data = node.data();
        
        let details = '';
        
        // Type badge
        const typeColors = {
            'hub': '#4a90e2',
            'link': '#66bb6a',
            'satellite': '#ffa726'
        };
        const typeColor = typeColors[data.type] || '#999';
        
        // Main classification
        details += `📌 TYPE: ${data.type.toUpperCase()}\n`;
        details += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        // WHY? - Show reasoning
        if (data.reasoning) {
            details += `❓ WHY IS THIS A ${data.type.toUpperCase()}?\n`;
            details += `${data.reasoning}\n\n`;
        }
        
        // Type-specific details
        if (data.type === 'hub') {
            if (data.businessKey) {
                details += `🔑 BUSINESS KEY: ${data.businessKey}\n`;
            }
            if (data.attributes && data.attributes.length > 0) {
                details += `📊 KEY ATTRIBUTES: ${data.attributes.join(', ')}\n`;
            }
            details += `\n💡 This is an independent business entity.\n`;
            details += `It can be queried and analyzed on its own.\n`;
        }
        
        else if (data.type === 'link') {
            if (data.connects && data.connects.length > 0) {
                details += `🔗 CONNECTS: ${data.connects.join(' ↔ ')}\n\n`;
                details += `💡 This represents a many-to-many relationship.\n`;
                details += `It bridges multiple business entities.\n`;
            }
        }
        
        else if (data.type === 'satellite') {
            if (data.parent) {
                details += `👨‍👩‍👧 PARENT ENTITY: ${data.parent}\n`;
            }
            if (data.attributes && data.attributes.length > 0) {
                details += `📝 ATTRIBUTES: ${data.attributes.join(', ')}\n`;
            }
            details += `\n💡 This describes a parent entity.\n`;
            details += `It provides context and detail, not independent data.\n`;
        }
        
        details += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        
        showNodeDetails(data.label, data.type, details);
    });

    // Highlight connected nodes on hover
    cy.on('mouseover', 'node', function(evt) {
        const node = evt.target;
        node.connectedEdges().addClass('highlighted');
    });

    cy.on('mouseout', 'node', function(evt) {
        const node = evt.target;
        node.connectedEdges().removeClass('highlighted');
    });

    checkConfig();
    injectModalStyles();
});

// Inject modal styles
function injectModalStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            overflow: auto;
            background-color: rgba(0, 0, 0, 0.5);
            animation: fadeIn 0.3s ease;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .modal-content {
            background-color: #f9f9f9;
            margin: 5% auto;
            padding: 30px;
            border-radius: 8px;
            width: 90%;
            max-width: 650px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            max-height: 70vh;
            overflow-y: auto;
        }
        
        .node-details-modal h2 {
            margin-top: 0;
            padding-bottom: 15px;
            font-size: 24px;
            color: #333;
            border-bottom: 4px solid #4a90e2;
        }
        
        .node-details-modal #nodeDetailsBody {
            color: #555;
            background: #fafafa;
            padding: 15px;
            border-left: 4px solid #ddd;
            border-radius: 4px;
            font-size: 13px;
            font-family: 'Monaco', 'Courier New', monospace;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        
        .close {
            color: #aaa;
            float: right;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            transition: color 0.3s;
        }
        
        .close:hover,
        .close:focus {
            color: #000;
        }
    `;
    document.head.appendChild(style);
}

// Show node details modal
function showNodeDetails(label, type, details) {
    let modal = document.getElementById('nodeDetailsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'nodeDetailsModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content node-details-modal">
                <span class="close">&times;</span>
                <h2 id="nodeDetailsTitle"></h2>
                <div id="nodeDetailsBody"></div>
            </div>
        `;
        document.body.appendChild(modal);
        
        modal.querySelector('.close').addEventListener('click', function() {
            modal.style.display = 'none';
        });
        
        window.addEventListener('click', function(event) {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
    
    const typeColors = {
        'hub': '#4a90e2',
        'link': '#66bb6a',
        'satellite': '#ffa726'
    };
    
    modal.querySelector('#nodeDetailsTitle').textContent = label;
    modal.querySelector('#nodeDetailsTitle').style.borderBottomColor = typeColors[type];
    modal.querySelector('#nodeDetailsBody').textContent = details;
    
    modal.style.display = 'block';
}

// Safe JSON parsing helper
async function parseJSON(response) {
    const text = await response.text();
    
    if (!text) {
        throw new Error('Empty response from server');
    }
    
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error('Failed to parse JSON:', text);
        throw new Error(`Invalid JSON response: ${text.substring(0, 200)}`);
    }
}

// Check API configuration
async function checkConfig() {
    try {
        const response = await fetch('/api/config/check');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await parseJSON(response);
        
        document.getElementById('ocrStatus').textContent = data.ocr_configured ? '✅ Configured' : '❌ Not Set';
        document.getElementById('ocrStatus').className = `status-value ${data.ocr_configured ? 'success' : 'error'}`;
        
        document.getElementById('groqStatus').textContent = data.groq_configured ? '✅ Configured' : '❌ Not Set';
        document.getElementById('groqStatus').className = `status-value ${data.groq_configured ? 'success' : 'error'}`;
        
        if (data.database) {
            console.log(`Database: ${data.database}`);
        }
    } catch (error) {
        console.error('Config check failed:', error);
        document.getElementById('ocrStatus').textContent = '⚠️ Error';
        document.getElementById('groqStatus').textContent = '⚠️ Error';
    }
}

// Upload knowledge document
async function uploadKnowledge() {
    const fileInput = document.getElementById('knowledgeFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showStatus('knowledgeStatus', 'Please select a file', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    showStatus('knowledgeStatus', 'Uploading methodology...', 'info');
    
    try {
        const response = await fetch('/api/knowledge/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const data = await parseJSON(response);
            showStatus('knowledgeStatus', `❌ ${data.error || 'Upload failed'}`, 'error');
            return;
        }
        
        const data = await parseJSON(response);
        
        if (data.success) {
            showStatus('knowledgeStatus', '✅ Methodology uploaded successfully!', 'success');
            fileInput.value = '';
        } else {
            showStatus('knowledgeStatus', `❌ ${data.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('Knowledge upload error:', error);
        showStatus('knowledgeStatus', `❌ Upload failed: ${error.message}`, 'error');
    }
}

// Upload source file and extract via OCR
async function uploadSource() {
    const fileInput = document.getElementById('sourceFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showStatus('uploadStatus', 'Please select a file', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    document.getElementById('uploadBtn').disabled = true;
    showStatus('uploadStatus', '⏳ Extracting text via OCR... This may take up to 2 minutes.', 'info');
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const data = await parseJSON(response);
            showStatus('uploadStatus', `❌ ${data.error || 'Upload failed'}`, 'error');
            return;
        }
        
        const data = await parseJSON(response);
        
        if (data.success) {
            currentOcrId = data.ocr_id;
            fullOcrText = data.full_text || data.extracted_text;
            
            document.getElementById('ocrPreviewText').value = fullOcrText;
            document.getElementById('ocrPreviewModal').style.display = 'block';
            
            fileInput.value = '';
        } else {
            showStatus('uploadStatus', `❌ ${data.error || 'Extraction failed'}`, 'error');
        }
    } catch (error) {
        console.error('Upload error:', error);
        showStatus('uploadStatus', `❌ Upload failed: ${error.message}`, 'error');
    } finally {
        document.getElementById('uploadBtn').disabled = false;
    }
}

// Manual schema submission
async function submitManualSchema() {
    const schemaText = document.getElementById('manualSchema').value.trim();
    
    if (!schemaText) {
        showStatus('uploadStatus', 'Please enter schema text', 'error');
        return;
    }
    
    document.getElementById('manualBtn').disabled = true;
    showStatus('uploadStatus', '⏳ Processing manual schema...', 'info');
    
    try {
        const response = await fetch('/api/manual-schema', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                schema_text: schemaText
            })
        });
        
        if (!response.ok) {
            const data = await parseJSON(response);
            showStatus('uploadStatus', `❌ ${data.error || 'Processing failed'}`, 'error');
            return;
        }
        
        const data = await parseJSON(response);
        
        if (data.success) {
            currentOcrId = data.ocr_id;
            fullOcrText = schemaText;
            
            document.getElementById('ocrPreviewText').value = fullOcrText;
            document.getElementById('ocrPreviewModal').style.display = 'block';
        } else {
            showStatus('uploadStatus', `❌ ${data.error || 'Processing failed'}`, 'error');
        }
    } catch (error) {
        console.error('Manual schema error:', error);
        showStatus('uploadStatus', `❌ Processing failed: ${error.message}`, 'error');
    } finally {
        document.getElementById('manualBtn').disabled = false;
    }
}

// Close OCR preview
function closeOcrPreview() {
    document.getElementById('ocrPreviewModal').style.display = 'none';
    currentOcrId = null;
    fullOcrText = '';
}

// Confirm OCR and enable generation
async function confirmOcrAndGenerate() {
    const editedText = document.getElementById('ocrPreviewText').value.trim();
    
    if (!editedText) {
        alert('Schema text cannot be empty!');
        return;
    }
    
    if (editedText !== fullOcrText) {
        console.log('📝 Text was edited, updating in database...');
        
        try {
            const response = await fetch('/api/update-ocr', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ocr_id: currentOcrId,
                    updated_text: editedText
                })
            });
            
            if (!response.ok) {
                console.error('Failed to update edited text');
            } else {
                console.log('✅ Updated text saved');
                fullOcrText = editedText;
            }
        } catch (error) {
            console.error('Error updating text:', error);
        }
    }
    
    document.getElementById('ocrPreviewModal').style.display = 'none';
    showStatus('uploadStatus', '✅ Schema loaded successfully! Ready to generate.', 'success');
    document.getElementById('generateBtn').disabled = false;
}

// Generate Data Vault model
async function generateModel() {
    if (!currentOcrId) {
        showStatus('generateStatus', 'Please upload and extract a source file first', 'error');
        return;
    }
    
    const grounded = document.getElementById('groundedMode').checked;
    
    document.getElementById('generateBtn').disabled = true;
    showStatus('generateStatus', '🧠 Generating Data Vault 2.1 model with AI... This may take up to 60 seconds.', 'info');
    
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ocr_id: currentOcrId,
                grounded: grounded
            })
        });
        
        if (!response.ok) {
            const data = await parseJSON(response);
            showStatus('generateStatus', `❌ ${data.error || 'Generation failed'}`, 'error');
            return;
        }
        
        const data = await parseJSON(response);
        
        if (data.success && data.model) {
            currentModel = data.model;
            showStatus('generateStatus', '✅ Model generated successfully!', 'success');
            visualizeModel(data.model);
            updateStats(data.model);
        } else {
            showStatus('generateStatus', `❌ ${data.error || 'No model returned'}`, 'error');
        }
    } catch (error) {
        console.error('Generate error:', error);
        showStatus('generateStatus', `❌ Generation failed: ${error.message}`, 'error');
    } finally {
        document.getElementById('generateBtn').disabled = false;
    }
}

// Visualize model with 4-layer hierarchy and draggable nodes
function visualizeModel(model) {
    cy.elements().remove();
    
    if (!model.nodes || model.nodes.length === 0) {
        showStatus('generateStatus', '⚠️ Model has no nodes', 'error');
        return;
    }
    
    try {
        console.log('🎨 Starting visualization...', model);
        
        const nodeIds = new Set();
        const validNodes = [];
        
        model.nodes.forEach(node => {
            if (!node.id) return;
            let cy;
let currentOcrId = null;
let currentModel = null;
let fullOcrText = '';

// Initialize Cytoscape with enhanced layout
document.addEventListener('DOMContentLoaded', function() {
    cy = cytoscape({
        container: document.getElementById('cy'),
        
        style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(label)',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'font-size': '12px',
                    'font-weight': '600',
                    'color': 'white',
                    'text-outline-width': 2,
                    'text-outline-color': 'data(borderColor)',
                    'width': 140,
                    'height': 70,
                    'shape': 'roundrectangle',
                    'text-wrap': 'wrap',
                    'text-max-width': '120px'
                }
            },
            {
                selector: 'node[type="hub"]',
                style: {
                    'background-color': '#4a90e2',
                    'border-width': 4,
                    'border-color': '#2c5aa0',
                    'shape': 'roundrectangle'
                }
            },
            {
                selector: 'node[type="link"]',
                style: {
                    'background-color': '#66bb6a',
                    'border-width': 4,
                    'border-color': '#43a047',
                    'shape': 'diamond',
                    'width': 120,
                    'height': 120
                }
            },
            {
                selector: 'node[type="satellite"]',
                style: {
                    'background-color': '#ffa726',
                    'border-width': 4,
                    'border-color': '#f57c00',
                    'shape': 'roundrectangle'
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 3,
                    'line-color': '#999',
                    'target-arrow-color': '#999',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'arrow-scale': 1.5,
                    'opacity': 0.8
                }
            },
            {
                selector: 'node:selected',
                style: {
                    'border-width': 6,
                    'border-color': '#ff4081',
                    'z-index': 999
                }
            },
            {
                selector: 'edge:selected',
                style: {
                    'width': 5,
                    'line-color': '#ff4081',
                    'target-arrow-color': '#ff4081'
                }
            }
        ]
    });

    // Enhanced click handler for nodes with reasoning
    cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        const data = node.data();
        
        let details = '';
        
        // Type badge
        const typeColors = {
            'hub': '#4a90e2',
            'link': '#66bb6a',
            'satellite': '#ffa726'
        };
        const typeColor = typeColors[data.type] || '#999';
        
        // Main classification
        details += `📌 TYPE: ${data.type.toUpperCase()}\n`;
        details += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        // WHY? - Show reasoning
        if (data.reasoning) {
            details += `❓ WHY IS THIS A ${data.type.toUpperCase()}?\n`;
            details += `${data.reasoning}\n\n`;
        }
        
        // Type-specific details
        if (data.type === 'hub') {
            if (data.businessKey) {
                details += `🔑 BUSINESS KEY: ${data.businessKey}\n`;
            }
            if (data.attributes && data.attributes.length > 0) {
                details += `📊 KEY ATTRIBUTES: ${data.attributes.join(', ')}\n`;
            }
            details += `\n💡 This is an independent business entity.\n`;
            details += `It can be queried and analyzed on its own.\n`;
        }
        
        else if (data.type === 'link') {
            if (data.connects && data.connects.length > 0) {
                details += `🔗 CONNECTS: ${data.connects.join(' ↔ ')}\n\n`;
                details += `💡 This represents a many-to-many relationship.\n`;
                details += `It bridges multiple business entities.\n`;
            }
        }
        
        else if (data.type === 'satellite') {
            if (data.parent) {
                details += `👨‍👩‍👧 PARENT ENTITY: ${data.parent}\n`;
            }
            if (data.attributes && data.attributes.length > 0) {
                details += `📝 ATTRIBUTES: ${data.attributes.join(', ')}\n`;
            }
            details += `\n💡 This describes a parent entity.\n`;
            details += `It provides context and detail, not independent data.\n`;
        }
        
        details += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        
        showNodeDetails(data.label, data.type, details);
    });

    // Highlight connected nodes on hover
    cy.on('mouseover', 'node', function(evt) {
        const node = evt.target;
        node.connectedEdges().addClass('highlighted');
    });

    cy.on('mouseout', 'node', function(evt) {
        const node = evt.target;
        node.connectedEdges().removeClass('highlighted');
    });

    checkConfig();
});

// Styles are now defined in style.css - no need to inject

// Show node details modal
function showNodeDetails(label, type, details) {
    let modal = document.getElementById('nodeDetailsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'nodeDetailsModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content node-details-modal">
                <span class="close">&times;</span>
                <h2 id="nodeDetailsTitle"></h2>
                <div id="nodeDetailsBody"></div>
            </div>
        `;
        document.body.appendChild(modal);
        
        modal.querySelector('.close').addEventListener('click', function() {
            modal.style.display = 'none';
        });
        
        window.addEventListener('click', function(event) {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
    
    const typeColors = {
        'hub': '#4a90e2',
        'link': '#66bb6a',
        'satellite': '#ffa726'
    };
    
    modal.querySelector('#nodeDetailsTitle').textContent = label;
    modal.querySelector('#nodeDetailsTitle').style.borderBottomColor = typeColors[type];
    modal.querySelector('#nodeDetailsBody').textContent = details;
    
    modal.style.display = 'block';
}

// Safe JSON parsing helper
async function parseJSON(response) {
    const text = await response.text();
    
    if (!text) {
        throw new Error('Empty response from server');
    }
    
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error('Failed to parse JSON:', text);
        throw new Error(`Invalid JSON response: ${text.substring(0, 200)}`);
    }
}

// Check API configuration
async function checkConfig() {
    try {
        const response = await fetch('/api/config/check');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await parseJSON(response);
        
        document.getElementById('ocrStatus').textContent = data.ocr_configured ? '✅ Configured' : '❌ Not Set';
        document.getElementById('ocrStatus').className = `status-value ${data.ocr_configured ? 'success' : 'error'}`;
        
        document.getElementById('groqStatus').textContent = data.groq_configured ? '✅ Configured' : '❌ Not Set';
        document.getElementById('groqStatus').className = `status-value ${data.groq_configured ? 'success' : 'error'}`;
        
        if (data.database) {
            console.log(`Database: ${data.database}`);
        }
    } catch (error) {
        console.error('Config check failed:', error);
        document.getElementById('ocrStatus').textContent = '⚠️ Error';
        document.getElementById('groqStatus').textContent = '⚠️ Error';
    }
}

// Upload knowledge document
async function uploadKnowledge() {
    const fileInput = document.getElementById('knowledgeFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showStatus('knowledgeStatus', 'Please select a file', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    showStatus('knowledgeStatus', 'Uploading methodology...', 'info');
    
    try {
        const response = await fetch('/api/knowledge/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const data = await parseJSON(response);
            showStatus('knowledgeStatus', `❌ ${data.error || 'Upload failed'}`, 'error');
            return;
        }
        
        const data = await parseJSON(response);
        
        if (data.success) {
            showStatus('knowledgeStatus', '✅ Methodology uploaded successfully!', 'success');
            fileInput.value = '';
        } else {
            showStatus('knowledgeStatus', `❌ ${data.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('Knowledge upload error:', error);
        showStatus('knowledgeStatus', `❌ Upload failed: ${error.message}`, 'error');
    }
}

// Upload source file and extract via OCR
async function uploadSource() {
    const fileInput = document.getElementById('sourceFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showStatus('uploadStatus', 'Please select a file', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    document.getElementById('uploadBtn').disabled = true;
    showStatus('uploadStatus', '⏳ Extracting text via OCR... This may take up to 2 minutes.', 'info');
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const data = await parseJSON(response);
            showStatus('uploadStatus', `❌ ${data.error || 'Upload failed'}`, 'error');
            return;
        }
        
        const data = await parseJSON(response);
        
        if (data.success) {
            currentOcrId = data.ocr_id;
            fullOcrText = data.full_text || data.extracted_text;
            
            document.getElementById('ocrPreviewText').value = fullOcrText;
            document.getElementById('ocrPreviewModal').style.display = 'block';
            
            fileInput.value = '';
        } else {
            showStatus('uploadStatus', `❌ ${data.error || 'Extraction failed'}`, 'error');
        }
    } catch (error) {
        console.error('Upload error:', error);
        showStatus('uploadStatus', `❌ Upload failed: ${error.message}`, 'error');
    } finally {
        document.getElementById('uploadBtn').disabled = false;
    }
}

// Manual schema submission
async function submitManualSchema() {
    const schemaText = document.getElementById('manualSchema').value.trim();
    
    if (!schemaText) {
        showStatus('uploadStatus', 'Please enter schema text', 'error');
        return;
    }
    
    document.getElementById('manualBtn').disabled = true;
    showStatus('uploadStatus', '⏳ Processing manual schema...', 'info');
    
    try {
        const response = await fetch('/api/manual-schema', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                schema_text: schemaText
            })
        });
        
        if (!response.ok) {
            const data = await parseJSON(response);
            showStatus('uploadStatus', `❌ ${data.error || 'Processing failed'}`, 'error');
            return;
        }
        
        const data = await parseJSON(response);
        
        if (data.success) {
            currentOcrId = data.ocr_id;
            fullOcrText = schemaText;
            
            document.getElementById('ocrPreviewText').value = fullOcrText;
            document.getElementById('ocrPreviewModal').style.display = 'block';
        } else {
            showStatus('uploadStatus', `❌ ${data.error || 'Processing failed'}`, 'error');
        }
    } catch (error) {
        console.error('Manual schema error:', error);
        showStatus('uploadStatus', `❌ Processing failed: ${error.message}`, 'error');
    } finally {
        document.getElementById('manualBtn').disabled = false;
    }
}

// Close OCR preview
function closeOcrPreview() {
    document.getElementById('ocrPreviewModal').style.display = 'none';
    currentOcrId = null;
    fullOcrText = '';
}

// Confirm OCR and enable generation
async function confirmOcrAndGenerate() {
    const editedText = document.getElementById('ocrPreviewText').value.trim();
    
    if (!editedText) {
        alert('Schema text cannot be empty!');
        return;
    }
    
    if (editedText !== fullOcrText) {
        console.log('📝 Text was edited, updating in database...');
        
        try {
            const response = await fetch('/api/update-ocr', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ocr_id: currentOcrId,
                    updated_text: editedText
                })
            });
            
            if (!response.ok) {
                console.error('Failed to update edited text');
            } else {
                console.log('✅ Updated text saved');
                fullOcrText = editedText;
            }
        } catch (error) {
            console.error('Error updating text:', error);
        }
    }
    
    document.getElementById('ocrPreviewModal').style.display = 'none';
    showStatus('uploadStatus', '✅ Schema loaded successfully! Ready to generate.', 'success');
    document.getElementById('generateBtn').disabled = false;
}

// Generate Data Vault model
async function generateModel() {
    if (!currentOcrId) {
        showStatus('generateStatus', 'Please upload and extract a source file first', 'error');
        return;
    }
    
    const grounded = document.getElementById('groundedMode').checked;
    
    document.getElementById('generateBtn').disabled = true;
    showStatus('generateStatus', '🧠 Generating Data Vault 2.1 model with AI... This may take up to 60 seconds.', 'info');
    
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ocr_id: currentOcrId,
                grounded: grounded
            })
        });
        
        if (!response.ok) {
            const data = await parseJSON(response);
            showStatus('generateStatus', `❌ ${data.error || 'Generation failed'}`, 'error');
            return;
        }
        
        const data = await parseJSON(response);
        
        if (data.success && data.model) {
            currentModel = data.model;
            showStatus('generateStatus', '✅ Model generated successfully!', 'success');
            visualizeModel(data.model);
            updateStats(data.model);
        } else {
            showStatus('generateStatus', `❌ ${data.error || 'No model returned'}`, 'error');
        }
    } catch (error) {
        console.error('Generate error:', error);
        showStatus('generateStatus', `❌ Generation failed: ${error.message}`, 'error');
    } finally {
        document.getElementById('generateBtn').disabled = false;
    }
}

// Visualize model with 3-layer hierarchy
function visualizeModel(model) {
    cy.elements().remove();
    
    if (!model.nodes || model.nodes.length === 0) {
        showStatus('generateStatus', '⚠️ Model has no nodes', 'error');
        return;
    }
    
    try {
        console.log('🎨 Starting visualization...', model);
        
        const nodeIds = new Set();
        const validNodes = [];
        
        model.nodes.forEach(node => {
            if (!node.id) return;
            const sanitizedId = String(node.id).trim();
            if (nodeIds.has(sanitizedId)) return;
            nodeIds.add(sanitizedId);
            validNodes.push({ ...node, id: sanitizedId });
        });
        
        console.log(`✅ Validated ${validNodes.length} nodes`);
        
        const hubNodes = validNodes.filter(n => n.type === 'hub');
        const linkNodes = validNodes.filter(n => n.type === 'link');
        const satelliteNodes = validNodes.filter(n => n.type === 'satellite');
        
        console.log(`📊 ${hubNodes.length} hubs, ${linkNodes.length} links, ${satelliteNodes.length} satellites`);
        
        validNodes.forEach(node => {
            const borderColor = node.type === 'hub' ? '#2c5aa0' : 
                               node.type === 'link' ? '#43a047' : '#f57c00';
            
            cy.add({
                group: 'nodes',
                data: {
                    id: node.id,
                    label: node.id,
                    type: node.type || 'hub',
                    businessKey: node.businessKey || '',
                    parent: node.parent || '',
                    connects: node.connects || [],
                    attributes: node.attributes || [],
                    reasoning: node.reasoning || '',
                    borderColor: borderColor
                }
            });
        });
        
        const edgeArray = [];
        const allEdges = new Set();
        
        if (model.edges && Array.isArray(model.edges)) {
            model.edges.forEach(edge => {
                const sourceId = String(edge.from || edge.source || '').trim();
                const targetId = String(edge.to || edge.target || '').trim();
                
                if (sourceId && targetId && nodeIds.has(sourceId) && nodeIds.has(targetId)) {
                    const edgeKey = `${sourceId}->${targetId}`;
                    if (!allEdges.has(edgeKey)) {
                        allEdges.add(edgeKey);
                        edgeArray.push({ from: sourceId, to: targetId });
                    }
                }
            });
        }
        
        edgeArray.forEach((edge, idx) => {
            cy.add({
                group: 'edges',
                data: {
                    id: `edge-${idx}`,
                    source: edge.from,
                    target: edge.to
                }
            });
        });
        
        console.log(`✅ Added ${edgeArray.length} edges`);
        
        // Position nodes in 3 layers with better spacing
        const hubs = cy.nodes('[type="hub"]');
        const links = cy.nodes('[type="link"]');
        const satellites = cy.nodes('[type="satellite"]');
        
        const viewportWidth = document.getElementById('cy').offsetWidth || 1400;
        const centerX = viewportWidth / 2;
        const hubSpacing = 280;
        const satSpacing = 200;
        const verticalGap = 350;
        
        // Layer 1: HUBS at TOP (row-based layout)
        if (hubs.length > 0) {
            const hubsPerRow = 4;
            hubs.forEach((node, idx) => {
                const row = Math.floor(idx / hubsPerRow);
                const col = idx % hubsPerRow;
                const hubsInThisRow = Math.min(hubs.length - row * hubsPerRow, hubsPerRow);
                const rowWidth = (hubsInThisRow - 1) * hubSpacing;
                const x = centerX - rowWidth / 2 + col * hubSpacing;
                const y = 100 + row * 180;
                node.position({ x, y });
            });
        }
        
        const hubRowCount = Math.ceil(hubs.length / 4);
        const hubBottomY = 100 + (hubRowCount - 1) * 180;
        
        // Layer 2: LINKS in MIDDLE (row-based layout)
        const linkY = hubBottomY + verticalGap;
        if (links.length > 0) {
            const linksPerRow = 4;
            links.forEach((node, idx) => {
                const row = Math.floor(idx / linksPerRow);
                const col = idx % linksPerRow;
                const linksInThisRow = Math.min(links.length - row * linksPerRow, linksPerRow);
                const rowWidth = (linksInThisRow - 1) * hubSpacing;
                const x = centerX - rowWidth / 2 + col * hubSpacing;
                const y = linkY + row * 200;
                node.position({ x, y });
            });
        }
        
        const linkRowCount = Math.ceil(links.length / 4);
        const linkBottomY = linkY + (linkRowCount - 1) * 200;
        
        // Layer 3: SATELLITES at BOTTOM (wider spread, more rows)
        const satY = linkBottomY + verticalGap;
        if (satellites.length > 0) {
            const satsPerRow = 6;
            satellites.forEach((node, idx) => {
                const row = Math.floor(idx / satsPerRow);
                const col = idx % satsPerRow;
                const satsInThisRow = Math.min(satellites.length - row * satsPerRow, satsPerRow);
                const rowWidth = (satsInThisRow - 1) * satSpacing;
                const x = centerX - rowWidth / 2 + col * satSpacing;
                const y = satY + row * 160;
                node.position({ x, y });
            });
        }
        
        console.log(`Positioned: Hubs at y=100, Links at y=${linkY}, Satellites at y=${satY}`);
        
        cy.layout({
            name: 'preset',
            fit: false,
            padding: 50
        }).run();
        
        cy.fit(cy.elements(), 100);
        
        // Enable dragging for all nodes
        cy.nodes().forEach(node => {
            node.grabbable(true);
            node.pannable(false);
        });
        
        console.log('Layout complete!');
        
        showStatus('generateStatus', 
            `✅ Data Vault visualization complete! ${hubs.length} hubs (blue, top), ${links.length} links (green, middle), ${satellites.length} satellites (orange, bottom)`, 
            'success'
        );
        
    } catch (error) {
        console.error('❌ Visualization error:', error);
        showStatus('generateStatus', `❌ Visualization failed: ${error.message}`, 'error');
    }
}

// Update statistics
function updateStats(model) {
    const hubs = model.nodes.filter(n => n.type === 'hub').length;
    const links = model.nodes.filter(n => n.type === 'link').length;
    const satellites = model.nodes.filter(n => n.type === 'satellite').length;
    
    document.getElementById('hubCount').textContent = hubs;
    document.getElementById('linkCount').textContent = links;
    document.getElementById('satCount').textContent = satellites;
}

// Canvas controls
function resetLayout() {
    if (!currentModel) {
        alert('No model to reset. Please generate a model first.');
        return;
    }
    visualizeModel(currentModel);
}

function fitToScreen() {
    cy.fit(100);
}

function zoomIn() {
    cy.zoom(cy.zoom() * 1.2);
    cy.center();
}

function zoomOut() {
    cy.zoom(cy.zoom() * 0.8);
    cy.center();
}

// Export functions
function exportJSON() {
    if (!currentModel) {
        alert('No model to export. Please generate a model first.');
        return;
    }
    
    const dataStr = JSON.stringify(currentModel, null, 2);
    downloadFile(dataStr, 'data_vault_model.json', 'application/json');
}

function exportCSV() {
    if (!currentModel) {
        alert('No model to export. Please generate a model first.');
        return;
    }
    
    let csv = 'Entity,Type,Parent,BusinessKey,Connects,Attributes,Reasoning\n';
    
    currentModel.nodes.forEach(node => {
        const connects = (node.connects || []).join('; ');
        const attributes = (node.attributes || []).join('; ');
        const reasoning = (node.reasoning || '').replace(/"/g, '""');
        csv += `"${node.id}","${node.type}","${node.parent || ''}","${node.businessKey || ''}","${connects}","${attributes}","${reasoning}"\n`;
    });
    
    downloadFile(csv, 'data_vault_model.csv', 'text/csv');
}

function exportDrawIO() {
    if (!currentModel) {
        alert('No model to export. Please generate a model first.');
        return;
    }
    
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<mxfile host="app.diagrams.net">\n';
    xml += '  <diagram name="Data Vault Model">\n';
    xml += '    <mxGraphModel>\n';
    xml += '      <root>\n';
    xml += '        <mxCell id="0"/>\n';
    xml += '        <mxCell id="1" parent="0"/>\n';
    
    let nodeId = 2;
    const nodeMap = {};
    
    const hubs = currentModel.nodes.filter(n => n.type === 'hub');
    const links = currentModel.nodes.filter(n => n.type === 'link');
    const satellites = currentModel.nodes.filter(n => n.type === 'satellite');
    
    hubs.forEach((node, idx) => {
        const x = 100 + (idx % 4) * 280;
        const y = 100 + Math.floor(idx / 4) * 200;
        nodeMap[node.id] = nodeId;
        xml += `        <mxCell id="${nodeId}" value="${node.id}" style="rounded=1;fillColor=#4a90e2;strokeColor=#2c5aa0;fontColor=#ffffff;" vertex="1" parent="1">\n`;
        xml += `          <mxGeometry x="${x}" y="${y}" width="140" height="70" as="geometry"/>\n`;
        xml += `        </mxCell>\n`;
        nodeId++;
    });
    
    links.forEach((node, idx) => {
        const x = 150 + (idx % 4) * 280;
        const y = 400 + Math.floor(idx / 4) * 220;
        nodeMap[node.id] = nodeId;
        xml += `        <mxCell id="${nodeId}" value="${node.id}" style="rhombus;fillColor=#66bb6a;strokeColor=#43a047;fontColor=#ffffff;" vertex="1" parent="1">\n`;
        xml += `          <mxGeometry x="${x}" y="${y}" width="120" height="120" as="geometry"/>\n`;
        xml += `        </mxCell>\n`;
        nodeId++;
    });
    
    satellites.forEach((node, idx) => {
        const x = 100 + (idx % 5) * 260;
        const y = 700 + Math.floor(idx / 5) * 180;
        nodeMap[node.id] = nodeId;
        xml += `        <mxCell id="${nodeId}" value="${node.id}" style="rounded=1;fillColor=#ffa726;strokeColor=#f57c00;fontColor=#ffffff;" vertex="1" parent="1">\n`;
        xml += `          <mxGeometry x="${x}" y="${y}" width="140" height="70" as="geometry"/>\n`;
        xml += `        </mxCell>\n`;
        nodeId++;
    });
    
    if (currentModel.edges) {
        currentModel.edges.forEach(edge => {
            const sourceId = nodeMap[edge.from || edge.source];
            const targetId = nodeMap[edge.to || edge.target];
            
            if (sourceId && targetId) {
                xml += `        <mxCell id="${nodeId}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;" edge="1" parent="1" source="${sourceId}" target="${targetId}">\n`;
                xml += `          <mxGeometry relative="1" as="geometry"/>\n`;
                xml += `        </mxCell>\n`;
                nodeId++;
            }
        });
    }
    
    xml += '      </root>\n';
    xml += '    </mxGraphModel>\n';
    xml += '  </diagram>\n';
    xml += '</mxfile>';
    
    downloadFile(xml, 'data_vault_model.drawio', 'application/xml');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function showStatus(elementId, message, type) {
    const element = document.getElementById(elementId);
    
    let statusEl = element.querySelector('.status-message');
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.className = 'status-message';
        element.appendChild(statusEl);
    }
    
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;
    statusEl.style.display = 'block';
    statusEl.style.whiteSpace = 'pre-wrap';
    
    if (type === 'success') {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 8000);
    }
}

// Update statistics
function updateStats(model) {
    const hubs = model.nodes.filter(n => n.type === 'hub').length;
    const links = model.nodes.filter(n => n.type === 'link').length;
    const satellites = model.nodes.filter(n => n.type === 'satellite').length;
    
    document.getElementById('hubCount').textContent = hubs;
    document.getElementById('linkCount').textContent = links;
    document.getElementById('satCount').textContent = satellites;
}

// Canvas controls
function resetLayout() {
    if (!currentModel) {
        alert('No model to reset. Please generate a model first.');
        return;
    }
    visualizeModel(currentModel);
}

function fitToScreen() {
    cy.fit(100);
}

function zoomIn() {
    cy.zoom(cy.zoom() * 1.2);
    cy.center();
}

function zoomOut() {
    cy.zoom(cy.zoom() * 0.8);
    cy.center();
}

// Export functions
function exportJSON() {
    if (!currentModel) {
        alert('No model to export. Please generate a model first.');
        return;
    }
    
    const dataStr = JSON.stringify(currentModel, null, 2);
    downloadFile(dataStr, 'data_vault_model.json', 'application/json');
}

function exportCSV() {
    if (!currentModel) {
        alert('No model to export. Please generate a model first.');
        return;
    }
    
    let csv = 'Entity,Type,Parent,BusinessKey,Connects,Attributes,Reasoning\n';
    
    currentModel.nodes.forEach(node => {
        const connects = (node.connects || []).join('; ');
        const attributes = (node.attributes || []).join('; ');
        const reasoning = (node.reasoning || '').replace(/"/g, '""');
        csv += `"${node.id}","${node.type}","${node.parent || ''}","${node.businessKey || ''}","${connects}","${attributes}","${reasoning}"\n`;
    });
    
    downloadFile(csv, 'data_vault_model.csv', 'text/csv');
}

function exportDrawIO() {
    if (!currentModel) {
        alert('No model to export. Please generate a model first.');
        return;
    }
    
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<mxfile host="app.diagrams.net">\n';
    xml += '  <diagram name="Data Vault Model">\n';
    xml += '    <mxGraphModel>\n';
    xml += '      <root>\n';
    xml += '        <mxCell id="0"/>\n';
    xml += '        <mxCell id="1" parent="0"/>\n';
    
    let nodeId = 2;
    const nodeMap = {};
    
    const hubs = currentModel.nodes.filter(n => n.type === 'hub');
    const links = currentModel.nodes.filter(n => n.type === 'link');
    const satellites = currentModel.nodes.filter(n => n.type === 'satellite');
    
    hubs.forEach((node, idx) => {
        const x = 100 + (idx % 4) * 280;
        const y = 100 + Math.floor(idx / 4) * 200;
        nodeMap[node.id] = nodeId;
        xml += `        <mxCell id="${nodeId}" value="${node.id}" style="rounded=1;fillColor=#4a90e2;strokeColor=#2c5aa0;fontColor=#ffffff;" vertex="1" parent="1">\n`;
        xml += `          <mxGeometry x="${x}" y="${y}" width="140" height="70" as="geometry"/>\n`;
        xml += `        </mxCell>\n`;
        nodeId++;
    });
    
    links.forEach((node, idx) => {
        const x = 150 + (idx % 4) * 280;
        const y = 400 + Math.floor(idx / 4) * 220;
        nodeMap[node.id] = nodeId;
        xml += `        <mxCell id="${nodeId}" value="${node.id}" style="rhombus;fillColor=#66bb6a;strokeColor=#43a047;fontColor=#ffffff;" vertex="1" parent="1">\n`;
        xml += `          <mxGeometry x="${x}" y="${y}" width="120" height="120" as="geometry"/>\n`;
        xml += `        </mxCell>\n`;
        nodeId++;
    });
    
    satellites.forEach((node, idx) => {
        const x = 100 + (idx % 5) * 260;
        const y = 700 + Math.floor(idx / 5) * 180;
        nodeMap[node.id] = nodeId;
        xml += `        <mxCell id="${nodeId}" value="${node.id}" style="rounded=1;fillColor=#ffa726;strokeColor=#f57c00;fontColor=#ffffff;" vertex="1" parent="1">\n`;
        xml += `          <mxGeometry x="${x}" y="${y}" width="140" height="70" as="geometry"/>\n`;
        xml += `        </mxCell>\n`;
        nodeId++;
    });
    
    if (currentModel.edges) {
        currentModel.edges.forEach(edge => {
            const sourceId = nodeMap[edge.from || edge.source];
            const targetId = nodeMap[edge.to || edge.target];
            
            if (sourceId && targetId) {
                xml += `        <mxCell id="${nodeId}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;" edge="1" parent="1" source="${sourceId}" target="${targetId}">\n`;
                xml += `          <mxGeometry relative="1" as="geometry"/>\n`;
                xml += `        </mxCell>\n`;
                nodeId++;
            }
        });
    }
    
    xml += '      </root>\n';
    xml += '    </mxGraphModel>\n';
    xml += '  </diagram>\n';
    xml += '</mxfile>';
    
    downloadFile(xml, 'data_vault_model.drawio', 'application/xml');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function showStatus(elementId, message, type) {
    const element = document.getElementById(elementId);
    
    let statusEl = element.querySelector('.status-message');
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.className = 'status-message';
        element.appendChild(statusEl);
    }
    
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;
    statusEl.style.display = 'block';
    statusEl.style.whiteSpace = 'pre-wrap';
    
    if (type === 'success') {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 8000);
    }
}
