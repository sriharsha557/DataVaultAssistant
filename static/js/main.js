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
                    'font-size': '11px',
                    'font-weight': '600',
                    'color': 'white',
                    'text-outline-width': 2,
                    'text-outline-color': 'data(borderColor)',
                    'width': 130,
                    'height': 60,
                    'shape': 'roundrectangle',
                    'text-wrap': 'wrap',
                    'text-max-width': '110px',
                    'cursor': 'pointer',
                    'padding': '5px'
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
                    'width': 110,
                    'height': 110
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
                    'width': 2,
                    'line-color': '#bbb',
                    'target-arrow-color': '#bbb',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'arrow-scale': 1.2,
                    'opacity': 0.7
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
                    'width': 4,
                    'line-color': '#ff4081',
                    'target-arrow-color': '#ff4081'
                }
            }
        ]
    });

    // Enhanced click handler for nodes with reasoning display
    cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        const data = node.data();
        
        let details = '';
        
        details += `TYPE: ${data.type.toUpperCase()}\n`;
        details += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        // REASONING - This is the critical part
        if (data.reasoning) {
            details += `WHY IS THIS A ${data.type.toUpperCase()}?\n`;
            details += `${data.reasoning}\n\n`;
        }
        
        // Type-specific details
        if (data.type === 'hub') {
            if (data.businessKey) {
                details += `BUSINESS KEY: ${data.businessKey}\n`;
            }
            if (data.attributes && data.attributes.length > 0) {
                details += `ATTRIBUTES: ${data.attributes.join(', ')}\n`;
            }
        }
        else if (data.type === 'link') {
            if (data.connects && data.connects.length > 0) {
                details += `CONNECTS: ${data.connects.join(' ↔ ')}\n`;
            }
        }
        else if (data.type === 'satellite') {
            if (data.parent) {
                details += `PARENT: ${data.parent}\n`;
            }
            if (data.attributes && data.attributes.length > 0) {
                details += `ATTRIBUTES: ${data.attributes.join(', ')}\n`;
            }
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
    
    const titleEl = modal.querySelector('#nodeDetailsTitle');
    titleEl.textContent = label;
    titleEl.className = `type-${type}`;
    
    const bodyEl = modal.querySelector('#nodeDetailsBody');
    bodyEl.textContent = details;
    
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
        
        document.getElementById('ocrStatus').textContent = data.ocr_configured ? 'Configured' : 'Not Set';
        document.getElementById('ocrStatus').className = `status-value ${data.ocr_configured ? 'success' : 'error'}`;
        
        document.getElementById('groqStatus').textContent = data.groq_configured ? 'Configured' : 'Not Set';
        document.getElementById('groqStatus').className = `status-value ${data.groq_configured ? 'success' : 'error'}`;
        
    } catch (error) {
        console.error('Config check failed:', error);
        document.getElementById('ocrStatus').textContent = 'Error';
        document.getElementById('groqStatus').textContent = 'Error';
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
            showStatus('knowledgeStatus', `${data.error || 'Upload failed'}`, 'error');
            return;
        }
        
        const data = await parseJSON(response);
        
        if (data.success) {
            showStatus('knowledgeStatus', 'Methodology uploaded successfully!', 'success');
            fileInput.value = '';
        } else {
            showStatus('knowledgeStatus', `${data.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('Knowledge upload error:', error);
        showStatus('knowledgeStatus', `Upload failed: ${error.message}`, 'error');
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
    showStatus('uploadStatus', 'Extracting text via OCR... This may take up to 2 minutes.', 'info');
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const data = await parseJSON(response);
            showStatus('uploadStatus', `${data.error || 'Upload failed'}`, 'error');
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
            showStatus('uploadStatus', `${data.error || 'Extraction failed'}`, 'error');
        }
    } catch (error) {
        console.error('Upload error:', error);
        showStatus('uploadStatus', `Upload failed: ${error.message}`, 'error');
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
    showStatus('uploadStatus', 'Processing manual schema...', 'info');
    
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
            showStatus('uploadStatus', `${data.error || 'Processing failed'}`, 'error');
            return;
        }
        
        const data = await parseJSON(response);
        
        if (data.success) {
            currentOcrId = data.ocr_id;
            fullOcrText = schemaText;
            
            document.getElementById('ocrPreviewText').value = fullOcrText;
            document.getElementById('ocrPreviewModal').style.display = 'block';
        } else {
            showStatus('uploadStatus', `${data.error || 'Processing failed'}`, 'error');
        }
    } catch (error) {
        console.error('Manual schema error:', error);
        showStatus('uploadStatus', `Processing failed: ${error.message}`, 'error');
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
        console.log('Text was edited, updating in database...');
        
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
                console.log('Updated text saved');
                fullOcrText = editedText;
            }
        } catch (error) {
            console.error('Error updating text:', error);
        }
    }
    
    document.getElementById('ocrPreviewModal').style.display = 'none';
    showStatus('uploadStatus', 'Schema loaded successfully! Ready to generate.', 'success');
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
    showStatus('generateStatus', 'Generating Data Vault 2.1 model with AI... This may take up to 60 seconds.', 'info');
    
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
            showStatus('generateStatus', `${data.error || 'Generation failed'}`, 'error');
            return;
        }
        
        const data = await parseJSON(response);
        
        if (data.success && data.model) {
            currentModel = data.model;
            showStatus('generateStatus', 'Model generated successfully!', 'success');
            visualizeModel(data.model);
            updateStats(data.model);
        } else {
            showStatus('generateStatus', `${data.error || 'No model returned'}`, 'error');
        }
    } catch (error) {
        console.error('Generate error:', error);
        showStatus('generateStatus', `Generation failed: ${error.message}`, 'error');
    } finally {
        document.getElementById('generateBtn').disabled = false;
    }
}

// Visualize model with proper 3-layer hierarchy - NO OVERLAPPING
function visualizeModel(model) {
    cy.elements().remove();
    
    if (!model.nodes || model.nodes.length === 0) {
        showStatus('generateStatus', 'Model has no nodes', 'error');
        return;
    }
    
    try {
        console.log('Starting visualization...', model);
        
        const nodeIds = new Set();
        const validNodes = [];
        
        model.nodes.forEach(node => {
            if (!node.id) return;
            const sanitizedId = String(node.id).trim();
            if (nodeIds.has(sanitizedId)) return;
            nodeIds.add(sanitizedId);
            validNodes.push({ ...node, id: sanitizedId });
        });
        
        console.log(`Validated ${validNodes.length} nodes`);
        
        // Separate by type
        const hubNodes = validNodes.filter(n => n.type === 'hub');
        const linkNodes = validNodes.filter(n => n.type === 'link');
        const satelliteNodes = validNodes.filter(n => n.type === 'satellite');
        
        console.log(`${hubNodes.length} hubs, ${linkNodes.length} links, ${satelliteNodes.length} satellites`);
        
        // Add nodes to Cytoscape WITH FULL NAMES and REASONING
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
                    reasoning: node.reasoning || 'No reasoning provided',
                    borderColor: borderColor
                }
            });
        });
        
        // Add edges
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
        
        console.log(`Added ${edgeArray.length} edges`);
        
        // PROPER 3-LAYER POSITIONING WITH NO OVERLAP
        const viewportWidth = document.getElementById('cy').offsetWidth || 1400;
        const viewportHeight = document.getElementById('cy').offsetHeight || 800;
        const centerX = viewportWidth / 2;
        
        // LAYER 1: HUBS (TOP)
        const hubY = 100;
        const hubSpacing = 280;
        const hubsPerRow = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(hubNodes.length))));
        
        hubNodes.forEach((node, idx) => {
            const row = Math.floor(idx / hubsPerRow);
            const col = idx % hubsPerRow;
            const totalWidth = (hubsPerRow - 1) * hubSpacing;
            const x = centerX - totalWidth / 2 + col * hubSpacing;
            const y = hubY + row * 150;
            cy.getElementById(node.id).position({ x, y });
        });
        
        const hubHeight = Math.ceil(hubNodes.length / hubsPerRow) * 150 + hubY;
        
        // LAYER 2: LINKS (MIDDLE) - SIGNIFICANT VERTICAL GAP
        const linkY = hubHeight + 300;
        const linkSpacing = 280;
        const linksPerRow = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(linkNodes.length))));
        
        linkNodes.forEach((node, idx) => {
            const row = Math.floor(idx / linksPerRow);
            const col = idx % linksPerRow;
            const totalWidth = (linksPerRow - 1) * linkSpacing;
            const x = centerX - totalWidth / 2 + col * linkSpacing;
            const y = linkY + row * 170;
            cy.getElementById(node.id).position({ x, y });
        });
        
        const linkHeight = Math.ceil(linkNodes.length / linksPerRow) * 170 + linkY;
        
        // LAYER 3: SATELLITES (BOTTOM) - WIDER SPREAD, LARGER GAP
        const satY = linkHeight + 300;
        const satSpacing = 220;
        const satsPerRow = Math.min(7, Math.max(1, Math.ceil(Math.sqrt(satelliteNodes.length))));
        
        satelliteNodes.forEach((node, idx) => {
            const row = Math.floor(idx / satsPerRow);
            const col = idx % satsPerRow;
            const totalWidth = (satsPerRow - 1) * satSpacing;
            const x = centerX - totalWidth / 2 + col * satSpacing;
            const y = satY + row * 140;
            cy.getElementById(node.id).position({ x, y });
        });
        
        console.log(`Positioned: Hubs at ${hubY}, Links at ${linkY}, Satellites at ${satY}`);
        
        // Apply preset layout
        cy.layout({
            name: 'preset',
            fit: false,
            padding: 50
        }).run();
        
        // Fit to screen with padding
        cy.fit(cy.elements(), 80);
        
        // Enable dragging for all nodes
        cy.nodes().forEach(node => {
            node.grabbable(true);
            node.selectable(true);
        });
        
        console.log('Layout complete!');
        
        showStatus('generateStatus', 
            `Data Vault visualization complete! ${hubNodes.length} hubs (blue, top), ${linkNodes.length} links (green, middle), ${satelliteNodes.length} satellites (orange, bottom)`, 
            'success'
        );
        
    } catch (error) {
        console.error('Visualization error:', error);
        showStatus('generateStatus', `Visualization failed: ${error.message}`, 'error');
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
    cy.fit(cy.elements(), 80);
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
