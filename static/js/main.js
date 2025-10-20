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
        // Removed default layout - we'll apply it manually in visualizeModel
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

// FIXED visualizeModel - Proper 3-layer hierarchy
function visualizeModel(model) {
    cy.elements().remove();
    
    if (!model.nodes || model.nodes.length === 0) {
        showStatus('generateStatus', '⚠️ Model has no nodes', 'error');
        return;
    }
    
    try {
        console.log('🎨 Starting visualization...', model);
        
        // Validate nodes
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
        
        // Separate by type
        const hubNodes = validNodes.filter(n => n.type === 'hub');
        const linkNodes = validNodes.filter(n => n.type === 'link');
        const satelliteNodes = validNodes.filter(n => n.type === 'satellite');
        
        console.log(`📊 ${hubNodes.length} hubs, ${linkNodes.length} links, ${satelliteNodes.length} satellites`);
        
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
        
        console.log(`✅ Added ${edgeArray.length} edges`);
        
        // === POSITION NODES IN 3 LAYERS ===
        const hubs = cy.nodes('[type="hub"]');
        const links = cy.nodes('[type="link"]');
        const satellites = cy.nodes('[type="satellite"]');
        
        const viewportWidth = document.getElementById('cy').offsetWidth || 1400;
        const centerX = viewportWidth / 2;
        const horizontalSpacing = 300;
        const verticalGap = 400;
        
        // Layer 1: HUBS at TOP
        if (hubs.length > 0) {
            const hubsPerRow = 5;
            hubs.forEach((node, idx) => {
                const row = Math.floor(idx / hubsPerRow);
                const col = idx % hubsPerRow;
                const hubsInRow = Math.min(hubs.length - row * hubsPerRow, hubsPerRow);
                const totalWidth = (hubsInRow - 1) * horizontalSpacing;
                const x = centerX - totalWidth / 2 + col * horizontalSpacing;
                const y = 150 + row * 200;
                node.position({ x, y });
            });
        }
        
        const hubRowCount = Math.ceil(hubs.length / 5);
        const hubBottom = 150 + (hubRowCount - 1) * 200;
        
        // Layer 2: LINKS in MIDDLE
        const linkY = hubBottom + verticalGap;
        if (links.length > 0) {
            const linksPerRow = 5;
            links.forEach((node, idx) => {
                const row = Math.floor(idx / linksPerRow);
                const col = idx % linksPerRow;
                const linksInRow = Math.min(links.length - row * linksPerRow, linksPerRow);
                const totalWidth = (linksInRow - 1) * horizontalSpacing;
                const x = centerX - totalWidth / 2 + col * horizontalSpacing;
                const y = linkY + row * 220;
                node.position({ x, y });
            });
        }
        
        const linkRowCount = Math.ceil(links.length / 5);
        const linkBottom = linkY + (linkRowCount - 1) * 220;
        
        // Layer 3: SATELLITES at BOTTOM
        const satY = linkBottom + verticalGap;
        if (satellites.length > 0) {
            const satsPerRow = 5;
            satellites.forEach((node, idx) => {
                const row = Math.floor(idx / satsPerRow);
                const col = idx % satsPerRow;
                const satsInRow = Math.min(satellites.length - row * satsPerRow, satsPerRow);
                const totalWidth = (satsInRow - 1) * horizontalSpacing;
                const x = centerX - totalWidth / 2 + col * horizontalSpacing;
                const y = satY + row * 200;
                node.position({ x, y });
            });
        }
        
        console.log(`✅ Positioned: Hubs at y=150, Links at y=${linkY}, Satellites at y=${satY}`);
        
        // Apply preset layout (uses our positions)
        cy.layout({
            name: 'preset',
            fit: true,
            padding: 100
        }).run();
        
        console.log('✅ Layout complete!');
        
        showStatus('generateStatus', 
            `✅ Data Vault visualization complete! ${hubs.length} hubs (top), ${links.length} links (middle), ${satellites.length} satellites (bottom)`, 
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

// Canvas controls - FIXED to use proper layout
function resetLayout() {
    if (!currentModel) {
        alert('No model to reset. Please generate a model first.');
        return;
    }
    // Just re-visualize the current model
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
    
    let csv = 'Entity,Type,Parent,BusinessKey,Connects,Attributes\n';
    
    currentModel.nodes.forEach(node => {
        const connects = (node.connects || []).join('; ');
        const attributes = (node.attributes || []).join('; ');
        csv += `"${node.id}","${node.type}","${node.parent || ''}","${node.businessKey || ''}","${connects}","${attributes}"\n`;
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
