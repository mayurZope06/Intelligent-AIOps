const fs = require('fs');
const path = require('path');

class RAGEngine {
  constructor() {
    this.runbooksDir = path.join(__dirname, 'runbooks');
    this.documents = [];
    this.chunks = [];
    this.ensureDirectory();
    this.loadAndIndexRunbooks();
  }

  ensureDirectory() {
    if (!fs.existsSync(this.runbooksDir)) {
      fs.mkdirSync(this.runbooksDir, { recursive: true });
    }
  }

  loadAndIndexRunbooks() {
    try {
      this.ensureDirectory();
      const files = fs.readdirSync(this.runbooksDir).filter(f => f.endsWith('.md'));
      this.documents = [];
      this.chunks = [];

      files.forEach((filename) => {
        const filePath = path.join(this.runbooksDir, filename);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Extract title from first line
        const firstLine = content.split('\n')[0] || filename;
        const title = firstLine.replace(/^#\s*/, '').trim();

        const doc = {
          id: filename.replace('.md', ''),
          filename,
          title,
          content,
          updatedAt: fs.statSync(filePath).mtime.toISOString()
        };
        this.documents.push(doc);

        // Chunk by sections (## headers)
        const sections = content.split(/\n(?=##\s+)/);
        sections.forEach((section, idx) => {
          const sectionTitleMatch = section.match(/^##\s*(.+)/);
          const sectionTitle = sectionTitleMatch ? sectionTitleMatch[1] : `Section ${idx + 1}`;
          
          this.chunks.push({
            id: `${doc.id}-chunk-${idx}`,
            docId: doc.id,
            docTitle: title,
            sectionTitle,
            text: section.trim(),
            terms: this.tokenize(section)
          });
        });
      });

      console.log(`[RAGEngine] Indexed ${this.documents.length} runbooks (${this.chunks.length} chunks) successfully.`);
    } catch (err) {
      console.error('[RAGEngine] Failed to load runbooks:', err.message);
    }
  }

  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  // Retrieve relevant runbook sections based on incident symptoms
  retrieveContext(queryText, topK = 2) {
    if (!this.chunks.length) {
      this.loadAndIndexRunbooks();
    }

    const queryTokens = this.tokenize(queryText);
    const scores = this.chunks.map(chunk => {
      let score = 0;
      const termFreq = {};
      chunk.terms.forEach(t => {
        termFreq[t] = (termFreq[t] || 0) + 1;
      });

      queryTokens.forEach(token => {
        if (termFreq[token]) {
          const weight = ['pool', 'database', 'mongo', 'exhausted', 'timeout', 'cpu', 'memory', 'crash', 'connection', '503', '502'].includes(token) ? 3.0 : 1.0;
          score += termFreq[token] * weight;
        }
      });

      return {
        chunk,
        score
      };
    });

    scores.sort((a, b) => b.score - a.score);
    const topMatches = scores.slice(0, topK).filter(s => s.score > 0);

    return topMatches.map(m => ({
      docId: m.chunk.docId,
      docTitle: m.chunk.docTitle,
      sectionTitle: m.chunk.sectionTitle,
      text: m.chunk.text,
      relevanceScore: Math.min(0.98, parseFloat((m.score / 15).toFixed(2)))
    }));
  }

  getAll() {
    return this.documents;
  }

  getById(id) {
    return this.documents.find(d => d.id === id) || null;
  }

  saveRunbook(id, title, content) {
    this.ensureDirectory();
    const cleanId = id.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const filePath = path.join(this.runbooksDir, `${cleanId}.md`);
    
    // Ensure first line has title
    let finalContent = content.trim();
    if (!finalContent.startsWith('# ')) {
      finalContent = `# ${title}\n\n${finalContent}`;
    }

    fs.writeFileSync(filePath, finalContent, 'utf-8');
    this.loadAndIndexRunbooks();
    return this.getById(cleanId);
  }

  deleteRunbook(id) {
    const filePath = path.join(this.runbooksDir, `${id}.md`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.loadAndIndexRunbooks();
      return true;
    }
    return false;
  }
}

module.exports = new RAGEngine();
