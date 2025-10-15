let cy;
let currentOcrId = null;
let currentModel = null;

// Initialize Cytoscape
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
                    'width': 120,
                    'height': 60,
                    'shape': 'roundrectangle'
                }
            },
            {
                selector: 'node[type="hub"]',
                style: {
                    'background-color': '#4a90e2',
                    'border-width': 3,
                    'border-color': '#2c5aa0'
                }
            },
            {
                selector: 'node[type="link"]',
                style: {
                    'background-color': '#66bb6a',
                    'border-width': 3,
                    'border-color': '#43a047',
                    'shape': 'diamond',
                    'width': 100,
                    'height': 100
                }
            },
            {
                selector: 'node[type="satellite"]',
                style: {
                    'background-color': '#ffa726',
                    'border-width': 3,
                    'border-color': '#f57c00'
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': '#999',
                    'target-arrow-color': '#999',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'arrow-scale': 1.5
                }
            },
            {
                selector: 'node:selected',
                style: {
                    'border-width': 5,
                    'border-color': '#ff4081'
                }
            }
        ],
        
        layout: {
            name: 'cose',
            animate: true,
            animationDuration: 1000,
            nodeRepulsion: 8000,
            idealEdgeLength: 150,
            edgeElasticity: 100
        }
    });

    // Add click handler for nodes
    cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        const data = node.data();
        
        let details = `Type: ${data.type}\n`;
        if (data.businessKey) details += `Business Key: ${data.businessKey}\n`;
        if (data.parent) details += `Parent: ${data.parent}\n`;
        if (data.connects) details += `Connects: ${data.connects.join(', ')}\n`;
        if (data.attributes) details += `Attributes: ${data.attributes.join(', ')}\n`;
        if (data.sourceTable) details += `Source: ${data.sourceTable}`;
        
        alert(`${data.label}\n\n${details}`);
    });

    checkConfig();
});

// Check API configuration
async function checkConfig() {
    try {
        const response = await fetch('/api/config/check');
        const data = await response.json();
        
        document.getElementById('ocrStatus').textContent = data.ocr_configured ? '✅ Configured' : '❌ Not Set';
        document.getElementById('ocrStatus').className = `status-value ${data.ocr_configured ? 'success' : 'error'}`;
        
        document.getElementById('groqStatus').textContent = data.groq_configured ? '✅ Configured' : '❌ Not Set';
        document.getElementById('groqStatus').className = `status-value ${data.groq_configured ? 'success' : 'error'}`;
    } catch (error) {
        console.error('Config check failed:', error);
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
        
        const data = await response.json();
        
        if (data.success) {
            showStatus('knowledgeStatus', '✅ Methodology uploaded successfully!', 'success');
        } else {
            showStatus('knowledgeStatus', `❌ ${data.error}`, 'error');
        }
    } catch (error) {
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
    showStatus('uploadStatus', '⏳ Extracting text via OCR...', 'info');
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentOcrId = data.ocr_id;
            showStatus('uploadStatus', `✅ Schema extracted successfully!\n\nPreview: ${data.extracted_text}`, 'success');
            document.getElementById('generateBtn').disabled = false;
        } else {
            showStatus('uploadStatus', `❌ ${data.error}`, 'error');
        }
    } catch (error) {
        showStatus('uploadStatus', `❌ Upload failed: ${error.message}`, 'error');
    } finally {
        document.getElementById('uploadBtn').disabled = false;
    }
}

// Generate Data Vault model
async function generateModel() {
    if (!currentOcrId) {
        showStatus('generateStatus', 'Please upload and extract a source file first', 'error');
        return;
    }
    
    const grounded = document.getElementById('groundedMode').checked;
    
    document.getElementById('generateBtn').disabled = true;
    showStatus('generateStatus', '🧠 Generating Data Vault 2.1 model with AI...', 'info');
    
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
        
        const data = await response.json();
        
        if (data.success) {
            currentModel = data.model;
            showStatus('generateStatus', '✅ Model generated successfully!', 'success');
            visualizeModel(data.model);
            updateStats(data.model);
        } else {
            showStatus('generateStatus', `❌ ${data.error}`, 'error');
        }
    } catch (error) {
        showStatus('generateStatus', `❌ Generation failed: ${error.message}`, 'error');
    } finally {
        document.getElementById('generateBtn').disabled = false;
    }
}

// Visualize model with Cytoscape
function visualizeModel(model) {
    cy.elements().remove();
    
    if (!model.nodes || model.nodes.length === 0) {
        return;
    }
    
    // Add nodes
    model.nodes.forEach(node => {
        cy.add({
            group: 'nodes',
            data: {
                id: node.id,
                label: node.id.replace(/^(Hub_|Link_|Sat_)/, ''),
                type: node.type,
                businessKey: node.businessKey,
                parent: node.parent,
                connects: node.connects,
                attributes: node.attributes,
                sourceTable: node.sourceTable,
                borderColor: node.type === 'hub' ? '#2c5aa0' : node.type === 'link' ? '#43a047' : '#f57c00'
            }
        });
    });
    
    // Add edges
    if (model.edges) {
        model.edges.forEach(edge => {
            cy.add({
                group: 'edges',
                data: {
                    source: edge.from,
                    target: edge.to
                }
            });
        });
    }
    
    // Apply layout
    cy.layout({
        name: 'cose',
        animate: true,
        animationDuration: 1000,
        nodeRepulsion: 8000,
        idealEdgeLength: 150,
        edgeElasticity: 100,
        padding: 50
    }).run();
    
    // Fit to screen after layout
    setTimeout(() => {
        cy.fit(50);
    }, 1200);
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
    if (cy.elements().length > 0) {
        cy.layout({
            name: 'cose',
            animate: true,
            animationDuration: 1000,
            nodeRepulsion: 8000,
            idealEdgeLength: 150,
            edgeElasticity: 100
        }).run();
    }
}

function fitToScreen() {
    cy.fit(50);
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
    
    let csv = 'Entity,Type,Parent,BusinessKey,Attributes,SourceTable\n';
    
    currentModel.nodes.forEach(node => {
        csv += `"${node.id}","${node.type}","${node.parent || ''}","${node.businessKey || ''}","${(node.attributes || []).join('; ')}","${node.sourceTable || ''}"\n`;
    });
    
    downloadFile(csv, 'data_vault_model.csv', 'text/csv');
}

function exportDrawIO() {
    if (!currentModel) {
        alert('No model to export. Please generate a model first.');
        return;
    }
    
    // Basic Draw.io XML structure
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<mxfile host="app.diagrams.net" modified="2024-01-01T00:00:00.000Z" agent="DataVault Assistant" version="21.0.0">\n';
    xml += '  <diagram name="Data Vault Model" id="dv-model">\n';
    xml += '    <mxGraphModel dx="1434" dy="844" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827">\n';
    xml += '      <root>\n';
    xml += '        <mxCell id="0"/>\n';
    xml += '        <mxCell id="1" parent="0"/>\n';
    
    let nodeId = 2;
    const nodeMap = {};
    
    // Add nodes
    currentModel.nodes.forEach((node, idx) => {
        const x = 100 + (idx % 5) * 200;
        const y = 100 + Math.floor(idx / 5) * 150;
        const color = node.type === 'hub' ? '#4a90e2' : node.type === 'link' ? '#66bb6a' : '#ffa726';
        
        nodeMap[node.id] = nodeId;
        
        xml += `        <mxCell id="${nodeId}" value="${node.id}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${color};strokeColor=#000000;fontColor=#ffffff;" vertex="1" parent="1">\n`;
        xml += `          <mxGeometry x="${x}" y="${y}" width="120" height="60" as="geometry"/>\n`;
        xml += `        </mxCell>\n`;
        
        nodeId++;
    });
    
    // Add edges
    if (currentModel.edges) {
        currentModel.edges.forEach(edge => {
            const sourceId = nodeMap[edge.from];
            const targetId = nodeMap[edge.to];
            
            if (sourceId && targetId) {
                xml += `        <mxCell id="${nodeId}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" edge="1" parent="1" source="${sourceId}" target="${targetId}">\n`;
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

// Helper function to download files
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

// Helper function to show status messages
function showStatus(elementId, message, type) {
    const element = document.getElementById(elementId);
    
    // Create or get status message element
    let statusEl = element.querySelector('.status-message');
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.className = 'status-message';
        element.appendChild(statusEl);
    }
    
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;
    statusEl.style.display = 'block';
    
    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 5000);
    }
}
