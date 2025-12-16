import { Setting, TFile, Notice, FuzzySuggestModal, MarkdownView, ButtonComponent, parseLinktext } from 'obsidian';

import PDFPlus from 'main';
import { PDFPlusModal } from 'modals';
import { DestArray } from 'typings';
import { parsePDFSubpath } from 'utils';

/**
 * Modal for creating a link annotation from a text selection.
 * Allows the user to select a destination within the same PDF or to another document.
 */
export class PDFLinkAnnotationModal extends PDFPlusModal {
    file: TFile;
    sourcePageNumber: number;
    onSubmit: (dest: DestArray | string, description?: string, selectionInfo?: { beginIndex: number, beginOffset: number, endIndex: number, endOffset: number }) => void;
    destType: 'internal' | 'external' = 'internal';
    targetPage: number = 1;
    destArray: DestArray | null = null;
    description: string = '';
    selectionInfo?: { beginIndex: number, beginOffset: number, endIndex: number, endOffset: number };

    externalUrl: string = '';

    constructor(plugin: PDFPlus, file: TFile, sourcePageNumber: number, onSubmit: (dest: DestArray | string, description?: string, selectionInfo?: { beginIndex: number, beginOffset: number, endIndex: number, endOffset: number }) => void, selectionInfo?: { beginIndex: number, beginOffset: number, endIndex: number, endOffset: number }) {
        super(plugin);
        this.file = file;
        this.sourcePageNumber = sourcePageNumber;
        this.onSubmit = onSubmit;
        this.targetPage = sourcePageNumber;
        this.selectionInfo = selectionInfo;
        
        this.containerEl.addClass('pdf-plus-link-annotation-modal');
    }

    async onOpen() {
        super.onOpen();
        this.titleEl.setText(`${this.plugin.manifest.name}: Create PDF link annotation`);
        
        this.contentEl.createEl('p', { 
            text: 'Select where this link should point to:',
            cls: 'pdf-plus-modal-description'
        });

        // Link type selector
        new Setting(this.contentEl)
            .setName('Link type')
            .setDesc('Choose between internal PDF link or external document link')
            .addDropdown((dropdown) => {
                dropdown
                    .addOption('internal', 'Internal (within this PDF)')
                    .addOption('external', 'External (to another document)')
                    .setValue(this.destType)
                    .onChange((value: 'internal' | 'external') => {
                        this.destType = value;
                        this.updateUI();
                    });
            });

        this.updateUI();

        // Check clipboard for valid links
        await this.checkClipboard();

        // Register Enter key global handler for the modal
        this.scope.register([], 'Enter', (evt) => {
            evt.preventDefault();
            this.submit();
        });
    }

    async checkClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (!text) return;
            const trimmed = text.trim();

            // Prioritize detection:
            // 1. Obsidian Link (Wikilink or Markdown Link to file in vault) - use as-is
            // 2. External URL (http/https) - use as-is
            // IMPORTANT: Always preserve wikilinks as-is.
            
            let linkText: string | null = null;

            if (this.isWikilink(trimmed)) {
                // Use wikilink directly
                linkText = trimmed;
                new Notice(`${this.plugin.manifest.name}: Detected Obsidian wikilink from clipboard`);
            } else if (this.isMarkdownLink(trimmed)) {
                // Convert markdown link to wikilink (if it points to a file in the vault)
                linkText = this.markdownLinkToWikilink(trimmed);
                if (linkText) new Notice(`${this.plugin.manifest.name}: Detected Markdown link from clipboard`);
            } else if (this.isUrl(trimmed)) {
                // Use URL as-is
                linkText = trimmed;
                new Notice(`${this.plugin.manifest.name}: Detected URL from clipboard`);
            }

            if (linkText) {
                this.destType = 'external';
                this.externalUrl = linkText;
                this.updateUI();
            }
        } catch (e) {
            // Ignore clipboard errors (e.g. if not focused)
        }
    }

    isUrl(text: string) {
        return text.startsWith('http://') || 
               text.startsWith('https://') || 
               text.startsWith('file://') || 
               text.startsWith('mailto:');
    }

    isWikilink(text: string) {
        return text.startsWith('[[') && text.endsWith(']]');
    }

    isMarkdownLink(text: string) {
        return text.startsWith('[') && text.includes('](') && text.endsWith(')');
    }

    markdownLinkToWikilink(text: string) {
        // Extract URL part: [display](url)
        const match = text.match(/\]\(([^)]+)\)/);
        if (match) {
            const url = match[1];
            if (this.isUrl(url)) {
                // External URL, return as-is
                return url;
            }
            // Decode if needed and convert to wikilink
            const decoded = decodeURI(url);
            const { path, subpath } = parseLinktext(decoded);
            const file = this.app.metadataCache.getFirstLinkpathDest(path, this.file.path);
            
            if (file) {
                const linktext = this.app.metadataCache.fileToLinktext(file, this.file.path);
                return `[[${linktext}${subpath || ''}]]`;
            }
        }
        return null;
    }

    updateUI() {
        // Clear previous settings
        const settings = this.contentEl.querySelectorAll('.setting');
        settings.forEach((setting, index) => {
            if (index > 0) setting.remove(); // Keep the first setting (link type)
        });

        if (this.destType === 'internal') {
            this.addInternalLinkSettings();
        } else {
            this.addExternalLinkSettings();
        }

        this.addButtons();
    }

    addInternalLinkSettings() {
        new Setting(this.contentEl)
            .setName('Target page')
            .setDesc('The page number within this PDF to link to')
            .addText((text) => {
                text.inputEl.type = 'number';
                text.inputEl.min = '1';
                text.setValue(String(this.targetPage))
                    .onChange((value) => {
                        const page = parseInt(value);
                        if (!isNaN(page) && page > 0) {
                            this.targetPage = page;
                            // XYZ destination: [page, 'XYZ', left, top, zoom]
                            // FitBH destination: [page, 'FitBH', top]
                            // We'll use XYZ with null values to fit the page
                            this.destArray = [page - 1, 'XYZ', null, null, null];
                        }
                    });
            });

        new Setting(this.contentEl)
            .setName('Link description (optional)')
            .setDesc('Add a description or tooltip for this link')
            .addText((text) => {
                text.setValue(this.description)
                    .setPlaceholder('Enter description...')
                    .onChange((value) => {
                        this.description = value;
                    });
            });

        new Setting(this.contentEl)
            .setName('Copy link from current view')
            .setDesc('Use the current page view as the link destination')
            .addButton((button) => {
                button
                    .setButtonText('Use current view')
                    .setTooltip('Use the current location in the active PDF viewer')
                    .onClick(() => {
                        // Try to get the most relevant PDF view
                        let view = this.lib.workspace.getActivePDFView();
                        
                        // If the active view is the same file as the one we are editing, try to find another one if available?
                        // Actually, user might want to link to THIS file (internal link).
                        // But if they have another file open, they might want to link to THAT file.
                        
                        if (!view) {
                            // Fallback: search for any PDF view
                            let foundView: any = null;
                            this.lib.workspace.iteratePDFViews((v) => {
                                if (!foundView) foundView = v;
                            });
                            view = foundView;
                        }

                        if (view) {
                            const state = view.getState();
                            
                            if (view.file === this.file) {
                                // Internal Link
                                this.destType = 'internal';
                                this.targetPage = state.page;
                                
                                // Create destination array based on current view state
                                if (typeof state.left === 'number' && typeof state.top === 'number') {
                                    const scaleValue = view.viewer.child?.pdfViewer.pdfViewer?.currentScaleValue;
                                    if (scaleValue === 'page-width') {
                                        this.destArray = [state.page - 1, 'FitBH', state.top];
                                    } else {
                                        this.destArray = [state.page - 1, 'XYZ', state.left, state.top, state.zoom ?? 0];
                                    }
                                } else {
                                    this.destArray = [state.page - 1, 'XYZ', null, null, null];
                                }
                                new Notice(`${this.plugin.manifest.name}: Using internal location: Page ${this.targetPage}`);
                            } else {
                                // External Link (to another PDF)
                                this.destType = 'external';
                                if (view.file) {
                                    const file = view.file;
                                    
                                    // Construct wikilink format: [[file.pdf#page=1]]
                                    let subpath = `#page=${state.page}`;
                                    if (typeof state.left === 'number' && typeof state.top === 'number') {
                                        // Add scroll info
                                        subpath += `&offset=${state.left},${state.top},${state.zoom ?? 0}`;
                                    }
                                    
                                    const linktext = this.app.metadataCache.fileToLinktext(file, this.file.path);
                                    this.externalUrl = `[[${linktext}${subpath}]]`;
                                    new Notice(`${this.plugin.manifest.name}: Linked to external PDF: ${file.basename}`);
                                }
                            }
                            
                            this.updateUI();
                        } else {
                            new Notice(`${this.plugin.manifest.name}: No active PDF view found`);
                        }
                    });
            });
    }

    addExternalLinkSettings() {
        new Setting(this.contentEl)
            .setName('Link destination')
            .setDesc('Enter a wikilink (e.g. [[file.pdf#page=1]]) or external URL (e.g. https://example.com)')
            .addText((text) => {
                text.setPlaceholder('[[file.pdf#page=1]] or https://example.com')
                    .setValue(this.externalUrl)
                    .onChange((value) => {
                        this.externalUrl = value;
                    });
                // Focus the input field
                text.inputEl.focus();
            });

        new Setting(this.contentEl)
            .setName('Link description (optional)')
            .setDesc('Add a description or tooltip for this link')
            .addText((text) => {
                text.setValue(this.description)
                    .setPlaceholder('Enter description...')
                    .onChange((value) => {
                        this.description = value;
                    });
            });
    }

    submit() {
        console.log('[PDFPlus] LinkAnnotationModal.submit() called', {
            destType: this.destType,
            destArray: this.destArray,
            targetPage: this.targetPage,
            externalUrl: this.externalUrl,
            description: this.description,
            selectionInfo: this.selectionInfo
        });

        if (this.destType === 'internal') {
            if (!this.destArray) {
                this.destArray = [this.targetPage - 1, 'XYZ', null, null, null];
            }
            console.log('[PDFPlus] Calling onSubmit with internal dest:', this.destArray, 'description:', this.description || undefined, 'selectionInfo:', this.selectionInfo);
            this.onSubmit(this.destArray, this.description || undefined, this.selectionInfo);
        } else {
            if (this.externalUrl) {
                // IMPORTANT: Always preserve wikilinks as-is.
                // If the user provides a wikilink, it should remain a wikilink.
                const urlToSave = this.externalUrl.trim();
                
                // Ensure wikilinks are preserved exactly as provided
                if (this.isWikilink(urlToSave)) {
                    console.log('[PDFPlus] Preserving wikilink as-is:', urlToSave);
                    this.onSubmit(urlToSave, this.description || undefined, this.selectionInfo);
                } else {
                    console.log('[PDFPlus] Calling onSubmit with external URL:', urlToSave, 'description:', this.description || undefined, 'selectionInfo:', this.selectionInfo);
                    this.onSubmit(urlToSave, this.description || undefined, this.selectionInfo);
                }
            } else {
                console.log('[PDFPlus] No external URL provided, showing notice');
                new Notice(`${this.plugin.manifest.name}: Please enter a URL`);
                return;
            }
        }
        console.log('[PDFPlus] Closing modal');
        this.close();
    }

    addButtons() {
        const buttonContainer = this.contentEl.createDiv('modal-button-container');
        
        new Setting(buttonContainer)
            .addButton((button) => {
                button
                    .setButtonText('Create Link')
                    .setCta()
                    .onClick(() => this.submit());
            })
            .addButton((button) => {
                button
                    .setButtonText('Cancel')
                    .onClick(() => this.close());
            })
            .setClass('no-border');
    }
}

/**
 * Modal to show all backlinks/connections for an annotation
 */
export class PDFAnnotationConnectionsModal extends PDFPlusModal {
    file: TFile;
    pageNumber: number;
    annotationId: string;

    constructor(plugin: PDFPlus, file: TFile, pageNumber: number, annotationId: string) {
        super(plugin);
        this.file = file;
        this.pageNumber = pageNumber;
        this.annotationId = annotationId;
        
        this.containerEl.addClass('pdf-plus-annotation-connections-modal');
    }

    async onOpen() {
        super.onOpen();
        this.titleEl.setText(`${this.plugin.manifest.name}: Annotation connections`);
        
        const loadingEl = this.contentEl.createEl('p', { text: 'Loading connections...' });

        try {
            const backlinks = await this.lib.getLatestBacklinksForAnnotation(this.file, this.pageNumber, this.annotationId);
            
            loadingEl.remove();

            if (backlinks.size === 0) {
                this.contentEl.createEl('p', { 
                    text: 'No connections found for this annotation.',
                    cls: 'mod-warning'
                });
                return;
            }

            this.contentEl.createEl('p', { 
                text: `Found ${backlinks.size} connection${backlinks.size === 1 ? '' : 's'}:`,
                cls: 'pdf-plus-modal-description'
            });

            const listEl = this.contentEl.createEl('ul', { cls: 'pdf-plus-connections-list' });

            for (const backlink of backlinks) {
                const file = this.app.vault.getAbstractFileByPath(backlink.sourcePath);
                if (!(file instanceof TFile)) continue;

                const itemEl = listEl.createEl('li');
                const linkEl = itemEl.createEl('a', {
                    text: file.basename,
                    cls: 'internal-link'
                });

                linkEl.addEventListener('click', (evt) => {
                    evt.preventDefault();
                    this.app.workspace.openLinkText(file.path, '', evt.ctrlKey || evt.metaKey);
                    this.close();
                });

                // Show the line where the link appears
                if ('position' in backlink.refCache) {
                    // @ts-ignore
                    const lineText = await this.getLineText(file, backlink.refCache.position.start.line);
                    if (lineText) {
                        itemEl.createEl('div', {
                            text: lineText.trim(),
                            cls: 'pdf-plus-connection-context'
                        });
                    }
                }
            }

        } catch (error) {
            loadingEl.remove();
            this.contentEl.createEl('p', { 
                text: 'Error loading connections: ' + (error as Error).message,
                cls: 'mod-warning'
            });
        }
    }

    async getLineText(file: TFile, line: number): Promise<string | null> {
        try {
            const content = await this.app.vault.read(file);
            const lines = content.split('\n');
            return lines[line] || null;
        } catch (error) {
            return null;
        }
    }
}

