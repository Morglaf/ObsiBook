import { App, Plugin, PluginSettingTab, Setting, Notice, WorkspaceLeaf, ItemView, TFile } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
const { remote } = require('electron');

const execPromise = promisify(exec);

interface BooksidianSettings {
    pandocPath: string;
    latexTemplatePath: string;
    templateFolderPath: string;
    xelatexPath: string;
    outputFolderPath: string;
    impositionPath: string;
    keepTempFolder: boolean;
    [key: string]: boolean | string;
}

const DEFAULT_SETTINGS: BooksidianSettings = {
    pandocPath: 'pandoc',
    latexTemplatePath: '',
    templateFolderPath: 'templates',
    xelatexPath: 'xelatex',
    outputFolderPath: '',
    impositionPath: 'non',
    impositionType: 'signature',
    keepTempFolder: false
}

const VIEW_TYPE_BOOKSIDIAN = "booksidian-view";

class BooksidianView extends ItemView {
    plugin: Booksidian;
    containerEl: HTMLElement;
    dynamicFieldsContainer: HTMLElement;
    toggleFieldsContainer: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: Booksidian) {
        super(leaf);
        this.plugin = plugin;
        this.containerEl = this.contentEl;
        this.dynamicFieldsContainer = this.containerEl.createDiv();
        this.toggleFieldsContainer = this.containerEl.createDiv();
        this.render();
    }

    getViewType() {
        return VIEW_TYPE_BOOKSIDIAN;
    }

    getDisplayText() {
        return "Booksidian Export";
    }

    getIcon() {
        return "document";
    }

    private transformToggleName(toggle: string): string {
        const name = toggle.replace(/^show/, '');
        return name.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
    }

    async render() {
        const { containerEl } = this;
        containerEl.empty();
    
        const style = document.createElement('style');
        style.textContent = `
            .booksidian-export-panel {
                padding: 10px;
            }
            .booksidian-export-panel > * {
                margin-bottom: 10px;
                display: block;
            }
            .booksidian-export-panel label {
                display: block;
                margin-bottom: 5px;
            }
            .dynamic-field {
                display: inline-block;
                margin-right: 5px;
                background-color: #1f1f1f;
                padding: 2px 5px;
                border-radius: 3px;
            }
        `;
        document.head.appendChild(style);
    
        containerEl.addClass('booksidian-export-panel');
        containerEl.createEl('h2', { text: 'Booksidian Export' });
    
        containerEl.createEl('label', { text: 'Template LaTeX :' });
        const templateDropdown = containerEl.createEl('select');
        this.plugin.templates.forEach(template => {
            const option = templateDropdown.createEl('option', { text: template });
            option.value = template;
        });
        templateDropdown.value = this.plugin.settings.latexTemplatePath;
        templateDropdown.onchange = async () => {
            this.plugin.settings.latexTemplatePath = templateDropdown.value;
            await this.plugin.saveData(this.plugin.settings);
            if (templateDropdown.value) {
                await this.updateDynamicFields(templateDropdown.value);
            }
        };
        containerEl.appendChild(templateDropdown);
    
        this.dynamicFieldsContainer = containerEl.createDiv({ cls: 'dynamic-fields-container' });
        this.toggleFieldsContainer = containerEl.createDiv({ cls: 'toggle-fields-container' });
    
        containerEl.createEl('label', { text: 'Imposition :' });
        const impositionDropdown = containerEl.createEl('select', { attr: { imposition: '' } });
        impositionDropdown.createEl('option', { text: 'Non', value: 'non' });
        this.plugin.impositions.forEach(imposition => {
            const option = impositionDropdown.createEl('option', { text: imposition });
            option.value = imposition;
        });
        impositionDropdown.value = this.plugin.settings.impositionPath;
        impositionDropdown.onchange = async () => {
            this.plugin.settings.impositionPath = impositionDropdown.value;
            await this.plugin.saveData(this.plugin.settings);
        };
        containerEl.appendChild(impositionDropdown);
    
        containerEl.createEl('label', { text: 'Chemin d\'exportation :' });
        const outputPathWrapper = containerEl.createDiv();
        const outputPathInput = outputPathWrapper.createEl('input', { type: 'text', placeholder: 'Output folder path' });
        outputPathInput.value = this.plugin.settings.outputFolderPath;
        outputPathInput.onchange = async () => {
            this.plugin.settings.outputFolderPath = outputPathInput.value;
            await this.plugin.saveData(this.plugin.settings);
        };
    
        const selectOutputButton = outputPathWrapper.createEl('button', { text: 'Sélectionner' });
        selectOutputButton.onclick = async () => {
            const result = await remote.dialog.showOpenDialog({
                properties: ['openDirectory']
            });
            if (result.filePaths && result.filePaths.length > 0) {
                outputPathInput.value = result.filePaths[0];
                this.plugin.settings.outputFolderPath = result.filePaths[0];
                await this.plugin.saveData(this.plugin.settings);
            }
        };
    
        const keepTempFolderSetting = new Setting(containerEl)
            .setName('Conserver le dossier temporaire')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.keepTempFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.keepTempFolder = value;
                        await this.plugin.saveData(this.plugin.settings);
                    });
            });
    
        const exportButton = containerEl.createEl('button', { text: 'Exporter' });
        exportButton.onclick = () => this.plugin.exportToLatex();
        containerEl.appendChild(exportButton);
    
        if (this.plugin.settings.latexTemplatePath) {
            await this.updateDynamicFields(this.plugin.settings.latexTemplatePath);
        }
    }
    
    
    
    
    

    async updateDynamicFields(templateName: string) {
        if (!templateName) {
            return;
        }
    
        const templatePath = this.plugin.getTemplatePath(templateName);
    
        const fields = await this.plugin.getDynamicFieldsFromTemplate(templatePath);
        this.dynamicFieldsContainer.empty();
        if (fields.length > 0) {
            this.dynamicFieldsContainer.createEl('label', { text: 'Champs dynamiques détectés :' });
            fields.forEach(field => {
                this.dynamicFieldsContainer.createEl('span', { text: field, cls: 'dynamic-field' });
            });
        } else {
            this.dynamicFieldsContainer.createEl('span', { text: 'Aucun champ dynamique détecté.' });
        }
    
        const toggles = await this.plugin.getToggleFieldsFromTemplate(templatePath);
        this.toggleFieldsContainer.empty();
        if (toggles.length > 0) {
            this.toggleFieldsContainer.createEl('label', { text: 'Options :' });
            toggles.forEach(toggle => {
                new Setting(this.toggleFieldsContainer)
                    .setName(this.transformToggleName(toggle))
                    .addToggle(toggleComponent => {
                        toggleComponent.setValue(Boolean(this.plugin.settings[toggle]))
                            .onChange(async (value) => {
                                this.plugin.settings[toggle] = value;
                                await this.plugin.saveData(this.plugin.settings);
                            });
                    });
            });
        }
    
        // Extraire le format du template sélectionné
        const templateParts = templateName.split('-');
        if (templateParts.length < 2) {
            new Notice("Le format du nom du template est incorrect.");
            return;
        }
        const templateFormat = templateParts[1].replace('.tex', '');
    
        console.log(`Template format extracted: ${templateFormat}`); // Debug log
    
        const filteredImpositions = this.plugin.impositions.filter(imposition => imposition.includes(templateFormat));
    
        console.log(`Filtered impositions: ${filteredImpositions}`); // Debug log
    
        const impositionDropdown = this.containerEl.querySelector('select[imposition]') as HTMLSelectElement;
        impositionDropdown.empty();
        impositionDropdown.createEl('option', { text: 'Non', value: 'non' });
        filteredImpositions.forEach(imposition => {
            const option = impositionDropdown.createEl('option', { text: imposition });
            option.value = imposition;
        });
        impositionDropdown.value = this.plugin.settings.impositionPath;
    }
    
    
    
    
    
}


export default class Booksidian extends Plugin {
    settings: BooksidianSettings = DEFAULT_SETTINGS;
    templates: string[] = [];
    impositions: string[] = [];

    async onload() {
        console.log('Loading Booksidian plugin');

        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.templates = await this.loadTemplates();
        this.impositions = await this.loadImpositions();

        this.registerView(
            VIEW_TYPE_BOOKSIDIAN,
            (leaf) => new BooksidianView(leaf, this)
        );

        this.app.workspace.onLayoutReady(this.initLeaf.bind(this));

        this.addSettingTab(new BooksidianSettingTab(this.app, this));
    }

    getBasePaths() {
        const basePath = (this.app.vault.adapter as any).getBasePath();
        const configDir = this.app.vault.configDir;
        const pluginPath = path.join(basePath, configDir, 'plugins', this.manifest.id);
        return { basePath, configDir, pluginPath };
    }

    getTemplatePath(templateName: string) {
        const { pluginPath } = this.getBasePaths();
        return path.join(pluginPath, this.settings.templateFolderPath, templateName);
    }

    initLeaf() {
        if (this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOKSIDIAN).length === 0) {
            this.app.workspace.getRightLeaf(false)?.setViewState({
                type: VIEW_TYPE_BOOKSIDIAN,
            });
        }
    }

    onunload() {
        console.log('Unloading Booksidian plugin');
        this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOKSIDIAN).forEach(leaf => leaf.detach());
    }

    async loadTemplates(): Promise<string[]> {
        return this.loadFilesFromFolder(this.settings.templateFolderPath, '.tex');
    }

    async loadImpositions(): Promise<string[]> {
        return this.loadFilesFromFolder('imposition', '.tex');
    }

    async loadFilesFromFolder(folderPath: string, extension: string): Promise<string[]> {
        const { pluginPath } = this.getBasePaths();
        const fullPath = path.join(pluginPath, folderPath);

        console.log(`Checking for files in: ${fullPath}`);

        if (fs.existsSync(fullPath)) {
            const files = fs.readdirSync(fullPath);
            console.log(`Files found in folder: ${files}`);
            return files.filter(file => file.endsWith(extension));
        } else {
            new Notice(`Folder not found: ${fullPath}`);
            return [];
        }
    }

    async getDynamicFieldsFromTemplate(templatePath: string): Promise<string[]> {
        const content = await fs.promises.readFile(templatePath, 'utf8');
        const fieldRegex = /\{\{(\w+)\}\}/g;
        const fields = new Set<string>();
        let match;
        while ((match = fieldRegex.exec(content)) !== null) {
            fields.add(match[1]);
        }
        return Array.from(fields);
    }
    
    async getToggleFieldsFromTemplate(templatePath: string): Promise<string[]> {
        const content = await fs.promises.readFile(templatePath, 'utf8');
        const toggleRegex = /\\newif\\if(\w+)/g;
        const toggles = new Set<string>();
        let match;
        while ((match = toggleRegex.exec(content)) !== null) {
            toggles.add(`show${match[1][0].toUpperCase()}${match[1].slice(1)}`);
        }
        return Array.from(toggles);
    }

    async exportToLatex() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file to export');
            return;
        }
    
        let markdown = await this.app.vault.read(activeFile);
        const pandocPath = this.settings.pandocPath;
        const { basePath } = this.getBasePaths();
        const tempDir = path.join(this.settings.outputFolderPath, 'temp');
        const markdownFilePath = path.join(basePath, activeFile.path);
    
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
    
        const tempMarkdownPath = path.join(tempDir, 'temp.md');
    
        try {
            markdown = await this.copyReferencedImages(markdown, tempDir, markdownFilePath);
            fs.writeFileSync(tempMarkdownPath, markdown);
    
            await this.copyTemplatesAndFonts(tempDir);
    
            const yamlData = this.app.metadataCache.getFileCache(activeFile)?.frontmatter;
            const args = `-f markdown -t latex "${tempMarkdownPath}" -o "${path.join(tempDir, activeFile.basename)}.tex"`;
    
            const { stderr } = await execPromise(`${pandocPath} ${args}`);
            if (stderr) {
                throw new Error(stderr);
            }
    
            const latexTemplatePath = path.join(tempDir, this.settings.latexTemplatePath);
            if (!latexTemplatePath) {
                throw new Error('No LaTeX template path specified');
            }
    
            let template = await fs.promises.readFile(latexTemplatePath, 'utf8');
            const fields = await this.getDynamicFieldsFromTemplate(latexTemplatePath);
            fields.forEach(field => {
                const value = yamlData?.[field] || field;
                template = template.replace(new RegExp(`\\{\\{${field}\\}\\}`, 'g'), value);
            });
    
            const toggles = await this.getToggleFieldsFromTemplate(latexTemplatePath);
            toggles.forEach(toggle => {
                const variableName = toggle.slice(4); // Remove 'show' prefix
                const trueFalseRegex = new RegExp(`\\\\${variableName}(true|false)`, 'g');
                template = template.replace(trueFalseRegex, ''); // Remove existing true/false lines
                const value = this.settings[toggle] ? `\\${variableName}true` : `\\${variableName}false`;
                template = template.replace(new RegExp(`\\\\newif\\\\if${variableName}\\b`, 'g'), `\\newif\\if${variableName}\n${value}`);
            });
    
            const contentPath = path.join(tempDir, `${activeFile.basename}.tex`);
            const content = await fs.promises.readFile(contentPath, 'utf8');
            template = template.replace('\\input{content.tex}', content);
    
            const latexFilePath = path.join(tempDir, `${activeFile.basename}.tex`);
            await fs.promises.writeFile(latexFilePath, template);
    
            const xelatexPath = this.settings.xelatexPath;
            const pdfFilePath = path.join(this.settings.outputFolderPath, `${activeFile.basename}.pdf`);
            const pdfArgs = `${xelatexPath} -output-directory="${tempDir}" "${latexFilePath}"`;
    
            const { stderr: pdfStderr } = await execPromise(pdfArgs, { cwd: tempDir });
            if (pdfStderr) {
                throw new Error(pdfStderr);
            }
    
            fs.copyFileSync(path.join(tempDir, `${activeFile.basename}.pdf`), pdfFilePath);
            new Notice(`Converted to PDF successfully at: ${pdfFilePath}`);
    
            if (this.settings.impositionPath !== 'non') {
                await this.applyImposition(pdfFilePath, this.settings.outputFolderPath);
            }
    
            const additionalTempFiles = [
                path.join(tempDir, 'rearranged.pdf'),
                path.join(tempDir, 'extended.pdf'),
                path.join(tempDir, 'blank-pages.pdf')
            ];
    
            this.cleanupTempFiles([latexFilePath, tempMarkdownPath, ...additionalTempFiles]);
    
        } catch (error) {
            const errorMessage = (error instanceof Error) ? error.message : String(error);
            console.error('Error during export:', error);
            new Notice(`Error during export: ${errorMessage}`);
        } finally {
            if (!this.settings.keepTempFolder) {
                try {
                    if (fs.existsSync(tempDir)) {
                        fs.rmdirSync(tempDir, { recursive: true });
                    }
                } catch (error) {
                    console.error('Error deleting temp folder:', error);
                }
            }
        }
    }
    
    
    

    async copyTemplatesAndFonts(tempDir: string) {
        const { pluginPath } = this.getBasePaths();
        const templateFolderPath = path.join(pluginPath, this.settings.templateFolderPath);

        if (fs.existsSync(templateFolderPath)) {
            try {
                await copyFolderToFlat(tempDir, templateFolderPath);
            } catch (err) {
                console.error(`Failed to copy folder: ${templateFolderPath} to ${tempDir}`, err);
                new Notice(`Failed to copy folder: ${templateFolderPath}`);
            }
        }
    }

    async copyReferencedImages(markdown: string, tempDir: string, markdownFilePath: string): Promise<string> {
        const imageRegex = /!\[\[([^\]]+)\]\]/g;
        const markdownDir = path.dirname(markdownFilePath);
        let match;
        const updatedMarkdown = markdown.replace(imageRegex, (match, p1) => {
            const srcPath = path.isAbsolute(p1) ? p1 : path.join((this.app.vault.adapter as any).getBasePath(), p1);
            const altSrcPath = path.join(markdownDir, p1);
            const destPath = path.join(tempDir, path.basename(p1));
            
            const existsAtSrcPath = fs.existsSync(srcPath);
            const existsAtAltSrcPath = fs.existsSync(altSrcPath);
            
            if (existsAtSrcPath || existsAtAltSrcPath) {
                const finalSrcPath = existsAtSrcPath ? srcPath : altSrcPath;
                fs.promises.copyFile(finalSrcPath, destPath).catch(err => {
                    console.error(`Failed to copy image: ${finalSrcPath} to ${destPath}`, err);
                    new Notice(`Failed to copy image: ${finalSrcPath}`);
                });
                return `![](${path.basename(p1)})`;
            } else {
                console.error(`Image not found at either location: ${srcPath}, ${altSrcPath}`);
                new Notice(`Image not found: ${p1}`);
                return match;
            }
        });
        return updatedMarkdown;
    }

    async cleanupTempFiles(files: string[]) {
        for (const file of files) {
            try {
                if (fs.existsSync(file)) {
                    await fs.promises.unlink(file);
                    console.log(`Deleted file: ${file}`);
                }
            } catch (error) {
                console.error(`Failed to delete file: ${file}`, error);
            }
        }
    }
    

    getBlankPagePath(templateFormat: string): string {
        const { pluginPath } = this.getBasePaths();
        return path.join(pluginPath, 'blank', `${templateFormat}-blank.pdf`);
    }

    async copyBlankPageToTemp(templateFormat: string, tempDir: string): Promise<string> {
        const blankPagePath = this.getBlankPagePath(templateFormat);
        if (!fs.existsSync(blankPagePath)) {
            throw new Error(`Blank page file not found: ${blankPagePath}`);
        }
        const tempBlankPagePath = path.join(tempDir, path.basename(blankPagePath));
        await fs.promises.copyFile(blankPagePath, tempBlankPagePath);
        return tempBlankPagePath;
    }

    async rearrangePagesForCheval(pdfFilePath: string, outputFolderPath: string, segmentSize: number, blankPagePath: string): Promise<string> {
        let numPages = await this.getNumberOfPages(pdfFilePath);
        const imposedPages: number[] = [];
        const totalAdjustedPages = Math.ceil(numPages / segmentSize) * segmentSize;
        const blankPagesNeeded = totalAdjustedPages - numPages;
        let processedPdfPath = pdfFilePath;
    
        if (blankPagesNeeded > 0) {
            // Ajouter des pages vierges à la fin du document
            const blankPagesPath = path.join(outputFolderPath, `blank-pages.pdf`);
            const blankPagesArgs = `pdftk ${Array(blankPagesNeeded).fill(blankPagePath).join(' ')} cat output "${blankPagesPath}"`;
            await execPromise(blankPagesArgs);
    
            const extendedPdfPath = path.join(outputFolderPath, `extended.pdf`);
            const extendArgs = `pdftk "${pdfFilePath}" "${blankPagesPath}" cat output "${extendedPdfPath}"`;
            await execPromise(extendArgs);
    
            processedPdfPath = extendedPdfPath;
            numPages = totalAdjustedPages;
        }
    
        const front = Array.from({ length: numPages / 2 }, (_, i) => i + 1);
        const back = Array.from({ length: numPages / 2 }, (_, i) => numPages - i);
    
        for (let i = 0; i < front.length; i++) {
            imposedPages.push(back[i], front[i]);
        }
    
        const uniquePages = new Set(imposedPages);
        if (uniquePages.size !== imposedPages.length) {
            console.error(`Duplicate pages found: ${imposedPages}`);
            throw new Error("Duplicate pages found in rearranged order");
        }
    
        const rearrangedPdfPath = path.join(outputFolderPath, 'rearranged.pdf');
        const pagesStr = imposedPages.join(' ');
    
        const args = `pdftk "${processedPdfPath}" cat ${pagesStr} output "${rearrangedPdfPath}"`;
        await execPromise(args);
    
        return rearrangedPdfPath;
    }
    
    
    
    async applyImposition(pdfFilePath: string, outputFolderPath: string) {
        const { pluginPath } = this.getBasePaths();
        const impositionFolderPath = path.join(pluginPath, 'imposition');
        const impositionTemplatePath = path.join(impositionFolderPath, this.settings.impositionPath);
    
        const pagesPerSegment = this.getPagesPerSegment();
        let numPages = await this.getNumberOfPages(pdfFilePath);
        let segments = Math.ceil(numPages / pagesPerSegment);
        const segmentPattern = path.join(outputFolderPath, `segment-%04d.pdf`);
    
        const templateParts = this.settings.latexTemplatePath.split('-');
        if (templateParts.length < 2) {
            new Notice("Le format du nom du template est incorrect.");
            return;
        }
        const templateFormat = templateParts[1].replace('.tex', '');
    
        const tempDir = path.join(this.settings.outputFolderPath, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
    
        const blankPagePath = await this.copyBlankPageToTemp(templateFormat, tempDir);
    
        let processedPdfPath = pdfFilePath;
    
        if (this.settings.impositionPath.includes('cheval')) {
            processedPdfPath = await this.rearrangePagesForCheval(pdfFilePath, outputFolderPath, pagesPerSegment, blankPagePath);
            // Mettre à jour numPages après réarrangement
            numPages = await this.getNumberOfPages(processedPdfPath);
            segments = Math.ceil(numPages / pagesPerSegment);
        }
    
        for (let i = 0; i < segments; i++) {
            const startPage = i * pagesPerSegment + 1;
            const endPage = Math.min((i + 1) * pagesPerSegment, numPages);
            const segmentOutput = segmentPattern.replace('%04d', (i + 1).toString().padStart(4, '0'));
            await this.splitPdf(processedPdfPath, segmentOutput, startPage, endPage);
        }
    
        const updatedSegments = [];
    
        for (let i = 0; i < segments; i++) {
            const segmentPath = segmentPattern.replace('%04d', (i + 1).toString().padStart(4, '0'));
            if (fs.existsSync(segmentPath)) {
                const updatedSegmentPath = await this.applyImpositionToSegment(segmentPath, impositionTemplatePath, outputFolderPath, blankPagePath, i);
                updatedSegments.push(updatedSegmentPath);
            } else {
                console.error(`Segment non trouvé: ${segmentPath}`);
            }
        }
    
        const imposedSegments = updatedSegments.filter(filePath => fs.existsSync(filePath));
    
        if (imposedSegments.length > 0) {
            const finalPdfPath = path.join(outputFolderPath, 'final-output.pdf');
            await this.mergePdfs(imposedSegments, finalPdfPath);
    
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                const finalPdfName = `${activeFile.basename}-${this.settings.impositionPath}`.replace('.tex', '') + '.pdf';
                const finalPdfRenamedPath = path.join(outputFolderPath, finalPdfName);
                fs.renameSync(finalPdfPath, finalPdfRenamedPath);
                new Notice(`Imposition appliquée avec succès à : ${finalPdfRenamedPath}`);
    
                await this.cleanupTempFiles([
                    ...imposedSegments,
                    ...imposedSegments.map(file => file.replace('.pdf', '.aux')),
                    ...imposedSegments.map(file => file.replace('.pdf', '.log')),
                    ...Array.from({ length: segments }, (_, i) => segmentPattern.replace('%04d', (i + 1).toString().padStart(4, '0')))
                ]);
            }
        } else {
            console.error('Aucun fichier imposé trouvé pour la fusion.');
            new Notice('Erreur : Aucun fichier imposé trouvé pour la fusion.');
        }
    
        // Suppression du dossier temp déplacée dans `exportToLatex`
    }
    
    
    
    
    
    
    
    

    

    getPagesPerSegment(): number {
        const match = this.settings.impositionPath.match(/(\d+)(signature|cheval)/);
        return match ? parseInt(match[1], 10) : 16;
    }

    async mergePdfs(inputFiles: string[], outputPdf: string) {
        const existingFiles = inputFiles.filter(file => fs.existsSync(file));

        if (existingFiles.length !== inputFiles.length) {
            console.error('Some PDF segments are missing, cannot merge.');
            new Notice('Erreur : Certains segments PDF sont manquants, fusion impossible.');
            return;
        }

        const args = `pdftk ${existingFiles.join(' ')} cat output "${outputPdf}"`;
        console.log(`Merging PDFs with command: ${args}`);
        try {
            const { stdout, stderr } = await execPromise(args);
            if (stderr) {
                throw new Error(stderr);
            }
            console.log(`Merge output: ${stdout}`);
        } catch (error) {
            console.error(`Erreur lors de la fusion des PDF: ${(error as Error).message}`);
            throw error;
        }
    }

    async applyImpositionToSegment(segmentPath: string, impositionTemplatePath: string, outputFolderPath: string, blankPagePath: string, segmentIndex: number): Promise<string> {
        const impositionTexPath = path.join(outputFolderPath, `imposition-segment-${segmentIndex}.tex`);
        let impositionTemplate = await fs.promises.readFile(impositionTemplatePath, 'utf8');
    
        const escapeLaTeXPath = (filePath: string) => {
            return filePath.replace(/\\/g, '/')
                           .replace(/ /g, '\\ ')
                           .replace(/_/g, '\\_')
                           .replace(/\$/g, '\\$')
                           .replace(/#/g, '\\#')
                           .replace(/{/g, '\\{')
                           .replace(/}/g, '\\}')
                           .replace(/&/g, '\\&')
                           .replace(/%/g, '\\%')
                           .replace(/\[/g, '\\[')
                           .replace(/\]/g, '\\]');
        };
    
        const escapedSegmentPath = escapeLaTeXPath(segmentPath);
    
        if (!fs.existsSync(segmentPath)) {
            console.error(`Segment non trouvé: ${segmentPath}`);
            new Notice(`Segment non trouvé: ${segmentPath}`);
            return segmentPath;
        }
    
        const pdfinfo = await execPromise(`pdfinfo "${segmentPath}"`);
        const numPagesMatch = pdfinfo.stdout.match(/Pages:\s+(\d+)/);
        const numPages = numPagesMatch ? parseInt(numPagesMatch[1], 10) : 0;
    
        const pagesPerSegment = this.getPagesPerSegment();
    
        let finalSegmentPath = segmentPath;
        let additionalPagesPath = '';
    
        if (numPages > 0 && numPages < pagesPerSegment) {
            const blankPagesNeeded = pagesPerSegment - numPages;
    
            additionalPagesPath = path.join(outputFolderPath, `additional-pages-${segmentIndex}.pdf`);
            const additionalPagesArgs = `pdftk ${Array(blankPagesNeeded).fill(blankPagePath).join(' ')} cat output "${additionalPagesPath}"`;
            await execPromise(additionalPagesArgs);
    
            finalSegmentPath = path.join(outputFolderPath, `updated-segment-${segmentIndex}.pdf`);
            const updatedSegmentArgs = `pdftk "${segmentPath}" "${additionalPagesPath}" cat output "${finalSegmentPath}"`;
            await execPromise(updatedSegmentArgs);
        }
    
        impositionTemplate = impositionTemplate.replace(/export\.pdf/g, escapeLaTeXPath(finalSegmentPath));
    
        await fs.promises.writeFile(impositionTexPath, impositionTemplate);
    
        const xelatexPath = this.settings.xelatexPath;
        const imposedPdfPath = path.join(outputFolderPath, `imposition-segment-${segmentIndex}.pdf`);
        const impositionArgs = `${xelatexPath} -output-directory="${outputFolderPath}" "${impositionTexPath}"`;
    
        try {
            const { stderr: impositionStderr, stdout: impositionStdout } = await execPromise(impositionArgs, { cwd: outputFolderPath });
            if (impositionStderr) {
                console.error('Erreur lors de l\'application de l\'imposition:', impositionStderr);
                new Notice('Erreur lors de l\'application de l\'imposition');
                return imposedPdfPath;
            }
    
            console.log(`Imposition stdout: ${impositionStdout}`);
        } catch (error) {
            console.error(`Erreur lors de l'application de l'imposition sur le segment ${segmentIndex}: ${(error as Error).message}`);
            throw error;
        } finally {
            const tempFiles = [impositionTexPath];
            if (additionalPagesPath) tempFiles.push(additionalPagesPath);
            if (finalSegmentPath !== segmentPath) tempFiles.push(finalSegmentPath);
            await this.cleanupTempFiles(tempFiles);
        }
    
        return imposedPdfPath;
    }
    
    
    
    

    async splitPdf(inputPdf: string, outputPattern: string, startPage: number, endPage: number) {
        const args = `pdftk "${inputPdf}" cat ${startPage}-${endPage} output "${outputPattern}"`;
        console.log(`Splitting PDF with command: ${args}`);
        try {
            const { stdout, stderr } = await execPromise(args);
            if (stderr) {
                throw new Error(stderr);
            }
            console.log(`Split output: ${stdout}`);
        } catch (error) {
            console.error(`Erreur lors de la division du PDF: ${(error as Error).message}`);
            throw error;
        }
    }

    async getNumberOfPages(pdfFilePath: string): Promise<number> {
        const args = `pdfinfo "${pdfFilePath}"`;
        try {
            const { stdout, stderr } = await execPromise(args);
            if (stderr) {
                throw new Error(stderr);
            }

            const match = stdout.match(/Pages:\s+(\d+)/);
            if (match) {
                return parseInt(match[1], 10);
            }

            throw new Error('Impossible de déterminer le nombre de pages dans le PDF.');
        } catch (error) {
            console.error(`Erreur lors de la récupération du nombre de pages: ${(error as Error).message}`);
            throw error;
        }
    }
}

class BooksidianSettingTab extends PluginSettingTab {
    plugin: Booksidian;

    constructor(app: App, plugin: Booksidian) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Settings for Booksidian plugin' });

        new Setting(containerEl)
            .setName('Pandoc Path')
            .setDesc('Path to the Pandoc executable')
            .addText(text => text
                .setPlaceholder('Enter the path to Pandoc')
                .setValue(this.plugin.settings.pandocPath)
                .onChange(async (value) => {
                    this.plugin.settings.pandocPath = value;
                    await this.plugin.saveData(this.plugin.settings);
                }));

        new Setting(containerEl)
            .setName('Template Folder Path')
            .setDesc('Path to the folder containing LaTeX templates')
            .addText(text => text
                .setPlaceholder('Enter the path to the template folder')
                .setValue(this.plugin.settings.templateFolderPath)
                .onChange(async (value) => {
                    this.plugin.settings.templateFolderPath = value;
                    this.plugin.templates = await this.plugin.loadTemplates();
                    await this.plugin.saveData(this.plugin.settings);
                    this.display();
                }));

        new Setting(containerEl)
            .setName('LaTeX Template')
            .setDesc('Select a LaTeX template')
            .addDropdown(dropdown => {
                this.plugin.templates.forEach(template => {
                    dropdown.addOption(template, template);
                });
                dropdown.setValue(this.plugin.settings.latexTemplatePath);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.latexTemplatePath = value;
                    await this.plugin.saveData(this.plugin.settings);
                });
            });

        new Setting(containerEl)
            .setName('Xelatex Path')
            .setDesc('Path to the xelatex executable')
            .addText(text => text
                .setPlaceholder('Enter the path to xelatex')
                .setValue(this.plugin.settings.xelatexPath)
                .onChange(async (value) => {
                    this.plugin.settings.xelatexPath = value;
                    await this.plugin.saveData(this.plugin.settings);
                }));

        new Setting(containerEl)
            .setName('Output Folder Path')
            .setDesc('Path to the folder where PDF files will be saved')
            .addText(text => text
                .setPlaceholder('Enter the path to the output folder')
                .setValue(this.plugin.settings.outputFolderPath)
                .onChange(async (value) => {
                    this.plugin.settings.outputFolderPath = value;
                    await this.plugin.saveData(this.plugin.settings);
                }));

        new Setting(containerEl)
            .setName('Imposition Path')
            .setDesc('Select an imposition template')
            .addDropdown(dropdown => {
                dropdown.addOption('non', 'Non');
                this.plugin.impositions.forEach(imposition => {
                    dropdown.addOption(imposition, imposition);
                });
                dropdown.setValue(this.plugin.settings.impositionPath);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.impositionPath = value;
                    await this.plugin.saveData(this.plugin.settings);
                });
            });

        new Setting(containerEl)
            .setName('Keep Temp Folder')
            .setDesc('Keep the temporary folder after export')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.keepTempFolder)
                .onChange(async (value) => {
                    this.plugin.settings.keepTempFolder = value;
                    await this.plugin.saveData(this.plugin.settings);
                }));
    }
}

async function copyFolderToFlat(destination: string, source: string) {
    const entries = await fs.promises.readdir(source, { withFileTypes: true });
    await fs.promises.mkdir(destination, { recursive: true });

    for (let entry of entries) {
        const srcPath = path.join(source, entry.name);
        const destPath = path.join(destination, entry.name);

        if (entry.isDirectory()) {
            await copyFolderToFlat(destination, srcPath);
        } else {
            await fs.promises.copyFile(srcPath, destPath);
        }
    }
}