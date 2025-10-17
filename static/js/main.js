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
        ],
        
        layout: {
            name: 'cose',
            animate: true,
            animationDuration: 1000,
            nodeRepulsion: 2000000,
            idealEdgeLength: 500,
            edgeElasticity: 50,
            nestingFactor: 2,
            gravity: 0.3,
            numIter: 3000,
            initialTemp: 2000,
            coolingFactor: 0.90,
            minTemp: 1.0,
            avoidOverlap: true,
            avoidOverlapPadding: 150
        }
    });

    // Add click handler for nodes with detailed information
    cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        const data = node.data();
        
        let details = `Type: ${data.type}\n`;
        if (data.businessKey) details += `Business Key: ${data.businessKey}\n`;
        if (data.parent) details += `Parent: ${data.parent}\n`;
        if (data.connects && data.connects.length > 0) {
            details += `Connects: ${data.connects.join(', ')}\n`;
        }
        if (data.attributes && data.attributes.length > 0) {
            details += `Attributes: ${data.attributes.join(', ')}\n`;
        }
        if (data.sourceTable) details += `Source Table: ${data.sourceTable}`;
        
        alert(`${data.label}\n\n${details}`);
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
        
        // Show database info
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
            
            // Show preview modal with editable textarea
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
            
            // Show preview modal with editable textarea
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
    // Get the edited text from textarea
    const editedText = document.getElementById('ocrPreviewText').value.trim();
    
    if (!editedText) {
        alert('Schema text cannot be empty!');
        return;
    }
    
    // If text was edited, update it in the database
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
            // Continue anyway - user can still generate with edited text
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

// Visualize model with Cytoscape - Enhanced with auto-edge creation
function visualizeModel(model) {
    cy.elements().remove();
    
    if (!model.nodes || model.nodes.length === 0) {
        showStatus('generateStatus', '⚠️ Model has no nodes', 'error');
        return;
    }
    
    try {
        console.log('🎨 Starting visualization...', model);
        
        // Validate and sanitize nodes
        const nodeIds = new Set();
        const validNodes = [];
        const nodeMap = new Map();
        
        model.nodes.forEach(node => {
            if (!node.id) {
                console.warn('Node missing ID:', node);
                return;
            }
            
            const sanitizedId = String(node.id).trim();
            if (nodeIds.has(sanitizedId)) {
                console.warn('Duplicate node ID:', sanitizedId);
                return;
            }
            
            nodeIds.add(sanitizedId);
            validNodes.push({
                ...node,
                id: sanitizedId
            });
            nodeMap.set(sanitizedId, node);
        });
        
        console.log(`✅ Validated ${validNodes.length} nodes`);
        
        // Add nodes to Cytoscape
        validNodes.forEach(node => {
            const borderColor = node.type === 'hub' ? '#2c5aa0' : 
                               node.type === 'link' ? '#43a047' : '#f57c00';
            
            cy.add({
                group: 'nodes',
                data: {
                    id: node.id,
                    label: node.id.replace(/^(Hub_|Link_|Sat_)/, ''),
                    type: node.type || 'hub',
                    businessKey: node.businessKey || '',
                    parent: node.parent || '',
                    connects: node.connects || [],
                    attributes: node.attributes || [],
                    sourceTable: node.sourceTable || '',
                    borderColor: borderColor
                }
            });
        });
        
        console.log(`✅ Added ${validNodes.length} nodes to visualization`);
        
        // Collect all edges (from model + auto-generated)
        const allEdges = new Set();
        const edgeArray = [];
        
        // Add edges from model
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
        
        console.log(`✅ Collected ${edgeArray.length} edges from model`);
        
        // Auto-generate missing edges for satellites
        validNodes.forEach(node => {
            if (node.type === 'satellite' && node.parent) {
                const parentId = String(node.parent).trim();
                if (nodeIds.has(parentId)) {
                    const edgeKey = `${parentId}->${node.id}`;
                    if (!allEdges.has(edgeKey)) {
                        allEdges.add(edgeKey);
                        edgeArray.push({ from: parentId, to: node.id });
                        console.log(`🔗 Auto-created edge: ${parentId} -> ${node.id}`);
                    }
                }
            }
            
            // Auto-generate edges for links
            if (node.type === 'link' && node.connects && Array.isArray(node.connects)) {
                node.connects.forEach(hubId => {
                    const sanitizedHubId = String(hubId).trim();
                    if (nodeIds.has(sanitizedHubId)) {
                        const edgeKey = `${sanitizedHubId}->${node.id}`;
                        if (!allEdges.has(edgeKey)) {
                            allEdges.add(edgeKey);
                            edgeArray.push({ from: sanitizedHubId, to: node.id });
                            console.log(`🔗 Auto-created edge: ${sanitizedHubId} -> ${node.id}`);
                        }
                    }
                });
            }
        });
        
        console.log(`✅ Total edges after auto-generation: ${edgeArray.length}`);
        
        // Add all edges to Cytoscape
        edgeArray.forEach((edge, idx) => {
            try {
                cy.add({
                    group: 'edges',
                    data: {
                        id: `edge-${idx}`,
                        source: edge.from,
                        target: edge.to
                    }
                });
            } catch (e) {
                console.warn(`Failed to add edge ${edge.from} -> ${edge.to}:`, e);
            }
        });
        
        console.log(`✅ Added ${edgeArray.length} edges to visualization`);
        
        // Apply enhanced layout with better spacing
        const layout = cy.layout({
            name: 'cose',
            animate: true,
            animationDuration: 1500,
            animationEasing: 'ease-out',
            // Physics parameters for better spacing
            nodeRepulsion: function(node) {
                // Links need more space due to diamond shape
                return node.data('type') === 'link' ? 2500000 : 2000000;
            },
            nodeOverlap: 200,
            idealEdgeLength: function(edge) {
                const sourceType = edge.source().data('type');
                const targetType = edge.target().data('type');
                // More space for link connections
                if (sourceType === 'link' || targetType === 'link') {
                    return 600;
                }
                return 500;
            },
            edgeElasticity: 50,
            nestingFactor: 2,
            gravity: 0.3,
            numIter: 3000,
            initialTemp: 2000,
            coolingFactor: 0.90,
            minTemp: 1.0,
            padding: 200,
            randomize: false,
            componentSpacing: 400,
            // Prevent overlaps
            avoidOverlap: true,
            avoidOverlapPadding: 150
        });
        
        layout.run();
        
        // Fit to screen after layout completes
        layout.on('layoutstop', function() {
            setTimeout(() => {
                cy.fit(80);
                console.log('✅ Layout complete and fitted to screen');
            }, 200);
        });
        
        showStatus('generateStatus', 
            `✅ Visualization complete: ${validNodes.length} nodes, ${edgeArray.length} edges`, 
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
    if (cy.elements().length > 0) {
        const layout = cy.layout({
            name: 'cose',
            animate: true,
            animationDuration: 1500,
            nodeRepulsion: function(node) {
                return node.data('type') === 'link' ? 2500000 : 2000000;
            },
            idealEdgeLength: 500,
            edgeElasticity: 50,
            gravity: 0.3,
            numIter: 3000,
            avoidOverlap: true,
            avoidOverlapPadding: 150
        });
        layout.run();
        
        layout.on('layoutstop', function() {
            setTimeout(() => cy.fit(80), 200);
        });
    }
}

function fitToScreen() {
    cy.fit(80);
}

function zoomIn() {
    cy.zoom(cy.zoom() * 1.3);
    cy.center();
}

function zoomOut() {
    cy.zoom(cy.zoom() * 0.7);
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
    
    let csv = 'Entity,Type,Parent,BusinessKey,Connects,Attributes,SourceTable\n';
    
    currentModel.nodes.forEach(node => {
        const connects = (node.connects || []).join('; ');
        const attributes = (node.attributes || []).join('; ');
        csv += `"${node.id}","${node.type}","${node.parent || ''}","${node.businessKey || ''}","${connects}","${attributes}","${node.sourceTable || ''}"\n`;
    });
    
    downloadFile(csv, 'data_vault_model.csv', 'text/csv');
}

function exportDrawIO() {
    if (!currentModel) {
        alert('No model to export. Please generate a model first.');
        return;
    }
    
    // Enhanced Draw.io XML with better positioning
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<mxfile host="app.diagrams.net" modified="2024-01-01T00:00:00.000Z" agent="DataVault Assistant" version="21.0.0">\n';
    xml += '  <diagram name="Data Vault Model" id="dv-model">\n';
    xml += '    <mxGraphModel dx="1434" dy="844" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1200">\n';
    xml += '      <root>\n';
    xml += '        <mxCell id="0"/>\n';
    xml += '        <mxCell id="1" parent="0"/>\n';
    
    let nodeId = 2;
    const nodeMap = {};
    
    // Organize nodes by type for better layout
    const hubs = currentModel.nodes.filter(n => n.type === 'hub');
    const links = currentModel.nodes.filter(n => n.type === 'link');
    const satellites = currentModel.nodes.filter(n => n.type === 'satellite');
    
    // Position hubs
    hubs.forEach((node, idx) => {
        const x = 100 + (idx % 4) * 300;
        const y = 100 + Math.floor(idx / 4) * 250;
        const color = '#4a90e2';
        
        nodeMap[node.id] = nodeId;
        
        xml += `        <mxCell id="${nodeId}" value="${node.id}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${color};strokeColor=#000000;strokeWidth=3;fontColor=#ffffff;fontSize=12;fontStyle=1;" vertex="1" parent="1">\n`;
        xml += `          <mxGeometry x="${x}" y="${y}" width="140" height="70" as="geometry"/>\n`;
        xml += `        </mxCell>\n`;
        
        nodeId++;
    });
    
    // Position links
    links.forEach((node, idx) => {
        const x = 150 + (idx % 4) * 300;
        const y = 400 + Math.floor(idx / 4) * 250;
        const color = '#66bb6a';
        
        nodeMap[node.id] = nodeId;
        
        xml += `        <mxCell id="${nodeId}" value="${node.id}" style="rhombus;whiteSpace=wrap;html=1;fillColor=${color};strokeColor=#000000;strokeWidth=3;fontColor=#ffffff;fontSize=12;fontStyle=1;" vertex="1" parent="1">\n`;
        xml += `          <mxGeometry x="${x}" y="${y}" width="120" height="120" as="geometry"/>\n`;
        xml += `        </mxCell>\n`;
        
        nodeId++;
    });
    
    // Position satellites
    satellites.forEach((node, idx) => {
        const x = 100 + (idx % 5) * 280;
        const y = 700 + Math.floor(idx / 5) * 200;
        const color = '#ffa726';
        
        nodeMap[node.id] = nodeId;
        
        xml += `        <mxCell id="${nodeId}" value="${node.id}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${color};strokeColor=#000000;strokeWidth=3;fontColor=#ffffff;fontSize=11;" vertex="1" parent="1">\n`;
        xml += `          <mxGeometry x="${x}" y="${y}" width="140" height="70" as="geometry"/>\n`;
        xml += `        </mxCell>\n`;
        
        nodeId++;
    });
    
    // Add edges
    if (currentModel.edges) {
        currentModel.edges.forEach(edge => {
            const sourceId = nodeMap[edge.from || edge.source];
            const targetId = nodeMap[edge.to || edge.target];
            
            if (sourceId && targetId) {
                xml += `        <mxCell id="${nodeId}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=2;strokeColor=#999999;" edge="1" parent="1" source="${sourceId}" target="${targetId}">\n`;
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
    
    // Handle multi-line messages
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;
    statusEl.style.display = 'block';
    statusEl.style.whiteSpace = 'pre-wrap';
    
    // Auto-hide success messages after 8 seconds
    if (type === 'success') {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 8000);
    }
}
