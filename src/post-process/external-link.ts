import { HoverParent, HoverPopover, Keymap, Notice } from 'obsidian';

import PDFPlus from 'main';
import { PDFPlusComponent } from 'lib/component';
import { AnnotationElement, PDFViewerChild } from 'typings';


export class PDFExternalLinkPostProcessor extends PDFPlusComponent implements HoverParent {
    child: PDFViewerChild;
    annot: AnnotationElement;

    static HOVER_LINK_SOURCE_ID = 'pdf-plus-external-link'; 

    constructor(plugin: PDFPlus, child: PDFViewerChild, annot: AnnotationElement) {
        super(plugin);
        this.child = child;
        this.annot = annot;
    }

    get hoverPopover() {
        return this.child.hoverPopover;
    }

    set hoverPopover(hoverPopover: HoverPopover | null) {
        this.child.hoverPopover = hoverPopover;
    }

    get hoverLinkSourceId() {
        return PDFExternalLinkPostProcessor.HOVER_LINK_SOURCE_ID;
    }

    onload() {
        console.log('[PDFPlus] ========== PDFExternalLinkPostProcessor.onload() START ==========');
        console.log('[PDFPlus] Annotation container:', this.annot.container);
        console.log('[PDFPlus] Annotation data:', {
            id: this.annot.data.id,
            subtype: this.annot.data.subtype,
            url: this.annot.data.url,
            A: this.annot.data.A,
            dest: this.annot.data.dest,
            hasUrl: 'url' in this.annot.data,
            hasA: 'A' in this.annot.data
        });
        
        // PDF.js might expose URI action URLs in different places:
        // 1. annot.data.url (direct property)
        // 2. annot.data.unsafeUrl (for potentially unsafe URLs, including wikilinks)
        // 3. annot.data.A?.URI (URI action object)
        let url: string | undefined = this.annot.data.url || this.annot.data.unsafeUrl;
        
        console.log('[PDFPlus] Initial URL check:', {
            url: this.annot.data.url,
            unsafeUrl: this.annot.data.unsafeUrl,
            extractedUrl: url
        });
        
        // If not found directly, check the action object
        if (!url && this.annot.data.A && typeof this.annot.data.A === 'object') {
            const action = this.annot.data.A as any;
            console.log('[PDFPlus] Checking action object:', action);
            if (action.URI) {
                url = typeof action.URI === 'string' ? action.URI : action.URI.str;
                console.log('[PDFPlus] Found URL in action.URI:', url);
            }
        }
        
        console.log('[PDFPlus] Final extracted URL:', url);
        console.log('[PDFPlus] Container element details:', {
            tagName: this.annot.container.tagName,
            className: this.annot.container.className,
            id: this.annot.container.id,
            dataset: { ...this.annot.container.dataset },
            outerHTML: this.annot.container.outerHTML.substring(0, 500)
        });

        if (!url) {
            console.log('[PDFPlus] No URL found in annotation data - exiting');
            console.log('[PDFPlus] ========== PDFExternalLinkPostProcessor.onload() END (no URL) ==========');
            return;
        }

        // Handle Obsidian wikilinks (e.g. [[file.pdf#page=1]])
        // IMPORTANT: Always preserve wikilinks as-is. Never convert wikilinks to obsidian:// links.
        if (url.startsWith('[[') && url.endsWith(']]')) {
            console.log('[PDFPlus] Detected wikilink, setting up click handler');
            
            // PDF.js creates anchor elements for internal links but not for external URI links
            // We need to create an anchor element manually to make it clickable like internal links
            let anchorEl = this.annot.container.querySelector<HTMLAnchorElement>('a');
            
            if (!anchorEl) {
                console.log('[PDFPlus] No anchor element found, creating one');
                // Create an anchor element similar to how PDF.js does for internal links
                anchorEl = this.annot.container.createEl('a', {
                    href: '#',
                    cls: 'internal-link'
                });
                // Make the anchor fill the container
                anchorEl.style.position = 'absolute';
                anchorEl.style.top = '0';
                anchorEl.style.left = '0';
                anchorEl.style.width = '100%';
                anchorEl.style.height = '100%';
                anchorEl.style.display = 'block';
                console.log('[PDFPlus] Created anchor element:', anchorEl);
            } else {
                console.log('[PDFPlus] Found existing anchor element:', anchorEl);
            }
            
            console.log('[PDFPlus] Container element:', {
                tagName: this.annot.container.tagName,
                className: this.annot.container.className,
                hasAnchor: !!anchorEl,
                containerHTML: this.annot.container.outerHTML.substring(0, 300)
            });

            // Register click handler on the anchor element (like internal links)
            // Use capture phase to ensure it runs before PDF.js's default handler
            // Handle ALL clicks (not just modifier key clicks) since PDF.js doesn't know how to handle wikilinks
            console.log('[PDFPlus] ========== Registering click handler for wikilink ==========');
            console.log('[PDFPlus] Anchor element:', anchorEl);
            console.log('[PDFPlus] Container element:', this.annot.container);
            
            const clickHandler = (evt: MouseEvent) => {
                console.log('[PDFPlus] ========== CLICK EVENT FIRED FOR WIKILINK ==========');
                console.log('[PDFPlus] Event details:', {
                    type: evt.type,
                    target: evt.target,
                    currentTarget: evt.currentTarget,
                    defaultPrevented: evt.defaultPrevented,
                    bubbles: evt.bubbles,
                    cancelable: evt.cancelable,
                    eventPhase: evt.eventPhase,
                    isModEvent: Keymap.isModEvent(evt),
                    button: evt.button,
                    buttons: evt.buttons,
                    clientX: evt.clientX,
                    clientY: evt.clientY
                });
                
                console.log('[PDFPlus] Processing click for wikilink', {
                    url,
                    sourceFile: this.child.file?.path
                });
                
                // Prevent default anchor behavior and PDF.js from handling this click
                console.log('[PDFPlus] Preventing default and stopping propagation');
                evt.preventDefault();
                evt.stopPropagation();
                evt.stopImmediatePropagation();
                
                // Remove [[ and ]] and handle alias
                let linktext = url.slice(2, -2);
                console.log('[PDFPlus] Extracted linktext before alias handling:', linktext);
                if (linktext.includes('|')) {
                    linktext = linktext.split('|')[0];
                    console.log('[PDFPlus] Removed alias, linktext now:', linktext);
                }
                
                console.log('[PDFPlus] Calling openLinkText with:', {
                    linktext,
                    sourcePath: this.child.file?.path || '',
                    newLeaf: Keymap.isModEvent(evt)
                });
                
                try {
                    this.app.workspace.openLinkText(linktext, this.child.file?.path || '', Keymap.isModEvent(evt));
                    console.log('[PDFPlus] openLinkText called successfully');
                } catch (e) {
                    console.error('[PDFPlus] Error calling openLinkText:', e);
                }
                console.log('[PDFPlus] ========== CLICK EVENT HANDLED ==========');
            };
            
            // Register on anchor element (like internal links)
            console.log('[PDFPlus] Registering click handler on anchor element with capture phase');
            this.registerDomEvent(anchorEl, 'click', clickHandler, { capture: true });
            console.log('[PDFPlus] Click handler registered on anchor');
            
            // Also register on container as fallback
            console.log('[PDFPlus] Also registering click handler on container (fallback)');
            this.registerDomEvent(this.annot.container, 'click', (evt) => {
                console.log('[PDFPlus] Container click handler triggered (fallback)');
                // Only handle if click is directly on container (not on anchor)
                if (evt.target === this.annot.container) {
                    clickHandler(evt);
                }
            }, { capture: true });

            // Prevent double-click from opening the connections modal for link annotations with URLs
            console.log('[PDFPlus] Registering dblclick handler to prevent connections modal');
            this.registerDomEvent(this.annot.container, 'dblclick', (evt) => {
                console.log('[PDFPlus] ========== DOUBLE-CLICK EVENT FIRED FOR WIKILINK ==========');
                console.log('[PDFPlus] Double-click event details:', {
                    target: evt.target,
                    currentTarget: evt.currentTarget,
                    defaultPrevented: evt.defaultPrevented
                });
                console.log('[PDFPlus] Preventing connections modal and opening link instead');
                evt.preventDefault();
                evt.stopPropagation();
                evt.stopImmediatePropagation();
                // Also trigger single click to open the link
                let linktext = url.slice(2, -2);
                if (linktext.includes('|')) {
                    linktext = linktext.split('|')[0];
                }
                console.log('[PDFPlus] Opening link from double-click:', linktext);
                this.app.workspace.openLinkText(linktext, this.child.file?.path || '', false);
            }, { capture: true });

            // Add shift+hover handler for wikilinks
            this.registerDomEvent(this.annot.container, 'mouseover', async () => {
                if (this.plugin.shiftHoverManager?.isActive()) {
                    await this.handleShiftHoverForWikilink(url);
                }
            });

            this.registerDomEvent(this.annot.container, 'mouseleave', () => {
                if (this.plugin.shiftHoverManager?.isActive()) {
                    this.plugin.shiftHoverManager.clearHighlight();
                }
            });
        }

        // Handle URLs that look like JSON-encoded PDF destinations (e.g., #[{"num":6,"gen":0},...])
        // These are malformed links created by a bug - convert to proper subpath and use openLinkText
        else if (url.startsWith('#') && url.length > 1) {
            try {
                const decoded = decodeURIComponent(url);
                
                if (decoded.startsWith('#[') || decoded.startsWith('#{')) {
                    const jsonStr = decoded.substring(1);
                    const destArray = JSON.parse(jsonStr);
                    
                    if (Array.isArray(destArray) && destArray.length >= 2) {
                        // Extract page number and destination params
                        // Format: [pageRef, {name: "XYZ"}, left, top, zoom]
                        let pageNumber: number | null = null;
                        const first = destArray[0];
                        if (typeof first === 'number') {
                            pageNumber = first;
                        } else if (first && typeof first === 'object' && 'num' in first) {
                            pageNumber = first.num;
                        }
                        
                        // Extract destination type and params
                        const destType = destArray[1]?.name || 'XYZ';
                        const left = destArray[2];
                        const top = destArray[3];
                        const zoom = destArray[4];
                        
                        if (pageNumber !== null) {
                            // Create anchor element
                            let anchorEl = this.annot.container.querySelector<HTMLAnchorElement>('a');
                            if (!anchorEl) {
                                anchorEl = this.annot.container.createEl('a', {
                                    href: '#',
                                    cls: 'internal-link'
                                });
                                anchorEl.style.position = 'absolute';
                                anchorEl.style.top = '0';
                                anchorEl.style.left = '0';
                                anchorEl.style.width = '100%';
                                anchorEl.style.height = '100%';
                                anchorEl.style.display = 'block';
                            }
                            
                            const clickHandler = (evt: MouseEvent) => {
                                evt.preventDefault();
                                evt.stopPropagation();
                                evt.stopImmediatePropagation();
                                
                                // Construct a proper Obsidian subpath from the destination
                                // Page number in PDF object refs is 0-based, convert to 1-based
                                const page = pageNumber! + 1;
                                
                                // Build subpath: #page=N&offset=left,top,zoom
                                let subpath = `#page=${page}`;
                                if (typeof left === 'number' && typeof top === 'number') {
                                    if (typeof zoom === 'number' && zoom > 0) {
                                        subpath += `&offset=${left},${top},${zoom}`;
                                    } else {
                                        // FitBH style - only top coordinate
                                        subpath += `&offset=,${top},`;
                                    }
                                }
                                
                                // Use the current file path + subpath as the linktext
                                const file = this.child.file;
                                if (file) {
                                    const linktext = file.path + subpath;
                                    this.app.workspace.openLinkText(linktext, '', Keymap.isModEvent(evt));
                                }
                            };
                            
                            this.registerDomEvent(anchorEl, 'click', clickHandler, { capture: true });
                            this.registerDomEvent(this.annot.container, 'click', (evt) => {
                                if (evt.target === this.annot.container) {
                                    clickHandler(evt);
                                }
                            }, { capture: true });
                        }
                    }
                }
            } catch (e) {
                // Not a JSON-encoded destination, ignore
            }
        }
        
        // Handle hover for http/https URLs (existing functionality)
        if (this.settings.popoverPreviewOnExternalLinkHover && this.app.plugins.enabledPlugins.has('surfing')) {
            this.registerDomEvent(this.annot.container, 'mouseover', (event) => {
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    this.app.workspace.trigger('hover-link', {
                        event,
                        source: this.hoverLinkSourceId,
                        hoverParent: this,
                        targetEl: this.annot.container,
                        linktext: url
                    });
                }
            });    
        }
        
        console.log('[PDFPlus] ========== PDFExternalLinkPostProcessor.onload() END ==========');
    }

    async handleShiftHoverForWikilink(url: string): Promise<void> {
        if (!this.child.file) return;

        const resolved = await this.plugin.shiftHoverManager.resolveWikilink(
            url, this.child.file
        );

        // Only highlight if link points to a specific annotation
        if (!resolved || !resolved.annotationId) return;

        // Find viewer for target file
        const targetChild = this.plugin.shiftHoverManager.findViewerForFile(resolved.file);
        if (!targetChild) {
            // File not open - do nothing
            return;
        }

        // Highlight the target annotation in the target viewer
        this.plugin.shiftHoverManager.highlightAnnotation(
            targetChild,
            resolved.page,
            resolved.annotationId
        );
    }

    static registerEvents(plugin: PDFPlus, child: PDFViewerChild, annot: AnnotationElement) {
        console.log('[PDFPlus] ========== PDFExternalLinkPostProcessor.registerEvents START ==========');
        console.log('[PDFPlus] Annotation details:', {
            subtype: annot.data.subtype,
            id: annot.data.id,
            url: annot.data.url,
            unsafeUrl: annot.data.unsafeUrl,
            A: annot.data.A,
            dest: annot.data.dest,
            hasComponent: !!child.component,
            file: child.file?.path
        });
        
        // Check for URL in multiple places
        // PDF.js stores potentially unsafe URLs (including wikilinks) in unsafeUrl instead of url
        let url: string | undefined = annot.data.url || annot.data.unsafeUrl;
        
        // If not found directly, check the action object
        if (!url && annot.data.A && typeof annot.data.A === 'object') {
            const action = annot.data.A as any;
            if (action.URI) {
                url = typeof action.URI === 'string' ? action.URI : (action.URI.str || action.URI);
            }
        }
        
        // Check for wikilinks ([[...]])
        const isWikilink = url && url.startsWith('[[');
        
        console.log('[PDFPlus] URL extraction results:', {
            extractedUrl: url,
            isWikilink,
            source: url ? (annot.data.url ? 'annot.data.url' : (annot.data.unsafeUrl ? 'annot.data.unsafeUrl' : 'annot.data.A.URI')) : 'none'
        });
        
        if (annot.data.subtype === 'Link' && url) {
            console.log('[PDFPlus] Creating PDFExternalLinkPostProcessor instance...');
            const processor = child.component?.addChild(new PDFExternalLinkPostProcessor(plugin, child, annot));
            console.log('[PDFPlus] PDFExternalLinkPostProcessor created:', !!processor);
            console.log('[PDFPlus] ========== PDFExternalLinkPostProcessor.registerEvents END (success) ==========');
            return processor;
        }
        
        console.log('[PDFPlus] PDFExternalLinkPostProcessor not created - conditions not met', {
            isLink: annot.data.subtype === 'Link',
            hasUrl: !!url
        });
        console.log('[PDFPlus] ========== PDFExternalLinkPostProcessor.registerEvents END (skipped) ==========');
        return null;
    }
}
