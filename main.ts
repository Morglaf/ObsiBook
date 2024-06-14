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
}

interface FrontMatter {
    titre?: string;
    auteur?: string;
}

const DEFAULT_SETTINGS: BooksidianSettings = {
    pandocPath: 'pandoc',
    latexTemplatePath: '',
    templateFolderPath: 'templates',
    xelatexPath: 'xelatex',
    outputFolderPath: '',
    impositionPath: 'non'
}

const VIEW_TYPE_BOOKSIDIAN = "booksidian-view";

class BooksidianView extends ItemView {
    plugin: Booksidian;
    containerEl: HTMLElement;
    dynamicFieldsContainer: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: Booksidian) {
        super(leaf);
        this.plugin = plugin;
        this.containerEl = this.contentEl;
        this.dynamicFieldsContainer = this.containerEl.createDiv();
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
            await this.updateDynamicFields(templateDropdown.value);
        };
        containerEl.appendChild(templateDropdown);

        this.dynamicFieldsContainer = containerEl.createDiv({ cls: 'dynamic-fields-container' });

        containerEl.createEl('label', { text: 'Imposition :' });
        const impositionDropdown = containerEl.createEl('select');
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

        const exportButton = containerEl.createEl('button', { text: 'Exporter' });
        exportButton.onclick = () => this.plugin.exportToLatex();
        containerEl.appendChild(exportButton);

        if (this.plugin.settings.latexTemplatePath) {
            await this.updateDynamicFields(this.plugin.settings.latexTemplatePath);
        }
    }

    async updateDynamicFields(templateName: string) {
        const basePath = (this.plugin.app.vault.adapter as any).getBasePath();
        const configDir = this.plugin.app.vault.configDir;
        const pluginPath = path.join(basePath, configDir, 'plugins', this.plugin.manifest.id);
        const templateFolderPath = path.join(pluginPath, this.plugin.settings.templateFolderPath);
        const templatePath = path.join(templateFolderPath, templateName);

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
    }
}

export default class Booksidian extends Plugin {
    settings: BooksidianSettings = DEFAULT_SETTINGS;
    templates: string[] = [];
    impositions: string[] = [];

    async onload() {
        console.log('Loading Booksidian plugin');

        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.templates = await this.loadTemplates(this.settings.templateFolderPath);
        this.impositions = await this.loadImpositions('imposition');

        this.registerView(
            VIEW_TYPE_BOOKSIDIAN,
            (leaf) => new BooksidianView(leaf, this)
        );

        this.app.workspace.onLayoutReady(this.initLeaf.bind(this));

        this.addSettingTab(new BooksidianSettingTab(this.app, this));
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

    async loadTemplates(folderPath: string): Promise<string[]> {
        const templates: string[] = [];
        const basePath = (this.app.vault.adapter as any).getBasePath();
        const configDir = this.app.vault.configDir;
        const pluginPath = path.join(basePath, configDir, 'plugins', this.manifest.id);
        const fullPath = path.join(pluginPath, folderPath);

        console.log(`Checking for templates in: ${fullPath}`);

        if (fs.existsSync(fullPath)) {
            const files = fs.readdirSync(fullPath);
            console.log(`Files found in template folder: ${files}`);

            files.forEach(file => {
                if (file.endsWith('.tex')) {
                    templates.push(file);
                }
            });
            console.log(`Templates loaded: ${templates}`);
        } else {
            new Notice(`Template folder not found: ${fullPath}`);
        }

        return templates;
    }

    async loadImpositions(folderPath: string): Promise<string[]> {
        const impositions: string[] = [];
        const basePath = (this.app.vault.adapter as any).getBasePath();
        const configDir = this.app.vault.configDir;
        const pluginPath = path.join(basePath, configDir, 'plugins', this.manifest.id);
        const fullPath = path.join(pluginPath, folderPath);

        console.log(`Checking for impositions in: ${fullPath}`);

        if (fs.existsSync(fullPath)) {
            const files = fs.readdirSync(fullPath);
            console.log(`Files found in imposition folder: ${files}`);

            files.forEach(file => {
                if (file.endsWith('.tex')) {
                    impositions.push(file);
                }
            });
            console.log(`Impositions loaded: ${impositions}`);
        } else {
            new Notice(`Imposition folder not found: ${fullPath}`);
        }

        return impositions;
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

    async exportToLatex() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file to export');
            return;
        }
    
        const markdown = await this.app.vault.read(activeFile);
        const pandocPath = this.settings.pandocPath;
        const basePath = (this.app.vault.adapter as any).getBasePath();
        const tempMarkdownPath = path.join(basePath, 'temp.md');
    
        try {
            fs.writeFileSync(tempMarkdownPath, markdown);
    
            const yamlData = this.app.metadataCache.getFileCache(activeFile)?.frontmatter;
            const args = `-f markdown -t latex "${tempMarkdownPath}" -o "${tempMarkdownPath.replace('.md', '.tex')}"`;
    
            const { stdout, stderr } = await execPromise(`${pandocPath} ${args}`, { encoding: 'utf8' });
            if (stderr) {
                throw new Error(stderr);
            }
    
            const configDir = this.app.vault.configDir;
            const pluginPath = path.join(basePath, configDir, 'plugins', this.manifest.id);
            const templateFolderPath = path.join(pluginPath, this.settings.templateFolderPath);
            const latexTemplatePath = path.join(templateFolderPath, this.settings.latexTemplatePath);
    
            if (!latexTemplatePath) {
                throw new Error('No LaTeX template path specified');
            }
    
            let template = await fs.promises.readFile(latexTemplatePath, 'utf8');
            const fields = await this.getDynamicFieldsFromTemplate(latexTemplatePath);
            fields.forEach(field => {
                const value = yamlData?.[field] || field;
                template = template.replace(new RegExp(`\\{\\{${field}\\}\\}`, 'g'), value);
            });
    
            const contentPath = tempMarkdownPath.replace('.md', '.tex');
            const content = await fs.promises.readFile(contentPath, 'utf8');
            template = template.replace('\\input{content.tex}', content);
    
            const latexFilePath = path.join(templateFolderPath, `${activeFile.basename}.tex`);
            await fs.promises.writeFile(latexFilePath, template);
    
            const xelatexPath = this.settings.xelatexPath;
            const outputFolderPath = this.settings.outputFolderPath || templateFolderPath;
            const pdfFilePath = path.join(outputFolderPath, `${activeFile.basename}.pdf`);
            const pdfArgs = `${xelatexPath} -output-directory="${outputFolderPath}" "${latexFilePath}"`;
    
            const { stderr: pdfStderr } = await execPromise(pdfArgs, { cwd: templateFolderPath });
            if (pdfStderr) {
                throw new Error(pdfStderr);
            }
    
            new Notice(`Converted to PDF successfully at: ${pdfFilePath}`);
    
            if (this.settings.impositionPath !== 'non') {
                await this.applyImposition(pdfFilePath, outputFolderPath);
            }
    
            const logFilePath = path.join(outputFolderPath, `${activeFile.basename}.log`);
            const auxFilePath = path.join(outputFolderPath, `${activeFile.basename}.aux`);
            this.cleanupFiles([latexFilePath, logFilePath, auxFilePath]);
    
        } catch (error) {
            const errorMessage = (error instanceof Error) ? error.message : String(error);
            console.error('Error during export:', error);
            new Notice(`Error during export: ${errorMessage}`);
        } finally {
            fs.unlinkSync(tempMarkdownPath);
        }
    }
    

    async applyImposition(pdfFilePath: string, outputFolderPath: string) {
        const basePath = (this.app.vault.adapter as any).getBasePath();
        const configDir = this.app.vault.configDir;
        const pluginPath = path.join(basePath, configDir, 'plugins', this.manifest.id);
        const impositionFolderPath = path.join(pluginPath, 'imposition');
        const impositionTemplatePath = path.join(impositionFolderPath, this.settings.impositionPath);
    
        const pagesPerSegmentMatch = this.settings.impositionPath.match(/(\d+)signature/);
        const pagesPerSegment = pagesPerSegmentMatch ? parseInt(pagesPerSegmentMatch[1], 10) : 16;
    
        const numPages = await this.getNumberOfPages(pdfFilePath);
        const segments = Math.ceil(numPages / pagesPerSegment);
        const segmentPattern = path.join(outputFolderPath, `segment-%04d.pdf`);
    
        for (let i = 0; i < segments; i++) {
            const startPage = i * pagesPerSegment + 1;
            const endPage = Math.min((i + 1) * pagesPerSegment, numPages);
            const segmentOutput = segmentPattern.replace('%04d', (i + 1).toString().padStart(4, '0'));
            await this.splitPdf(pdfFilePath, segmentOutput, startPage, endPage);
        }
    
        // Créer le fichier blank-page.pdf à partir de la page 2 du fichier original
        const blankPagePath = path.join(outputFolderPath, 'blank-page.pdf');
        console.log(`Creating blank-page.pdf from page 2 of ${pdfFilePath}`);
        await execPromise(`pdftk "${pdfFilePath}" cat 2 output "${blankPagePath}"`);
        console.log(`blank-page.pdf created at ${blankPagePath}`);
    
        const updatedSegments = [];
    
        for (let i = 0; i < segments; i++) {
            const segmentPath = segmentPattern.replace('%04d', (i + 1).toString().padStart(4, '0'));
            if (fs.existsSync(segmentPath)) {
                console.log(`Applying imposition to segment: ${segmentPath}`);
                const updatedSegmentPath = await this.applyImpositionToSegment(segmentPath, impositionTemplatePath, outputFolderPath, blankPagePath, i);
                updatedSegments.push(updatedSegmentPath);
            } else {
                console.error(`Segment non trouvé: ${segmentPath}`);
            }
        }
    
        const imposedSegmentPattern = path.join(outputFolderPath, `imposition-segment-%d.pdf`);
        const imposedSegments = updatedSegments.filter(filePath => fs.existsSync(filePath));
    
        if (imposedSegments.length > 0) {
            const finalPdfPath = path.join(outputFolderPath, 'final-output.pdf');
            await this.mergePdfs(imposedSegments, finalPdfPath);
    
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                const finalPdfName = `${activeFile.basename}-${this.settings.impositionPath}.pdf`;
                const finalPdfRenamedPath = path.join(outputFolderPath, finalPdfName);
                fs.renameSync(finalPdfPath, finalPdfRenamedPath);
                new Notice(`Imposition appliquée avec succès à : ${finalPdfRenamedPath}`);
    
                await this.cleanupFiles([
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
    
        const pagesPerSegmentMatch = this.settings.impositionPath.match(/(\d+)signature/);
        const pagesPerSegment = pagesPerSegmentMatch ? parseInt(pagesPerSegmentMatch[1], 10) : 16;
    
        let finalSegmentPath = segmentPath;
    
        if (numPages > 0 && numPages < pagesPerSegment) {
            const blankPagesNeeded = pagesPerSegment - numPages;
    
            const additionalPagesPath = path.join(outputFolderPath, `additional-pages-${segmentIndex}.pdf`);
            const additionalPagesArgs = `pdftk ${Array(blankPagesNeeded).fill(blankPagePath).join(' ')} cat output "${additionalPagesPath}"`;
            console.log(`Command: ${additionalPagesArgs}`);
            await execPromise(additionalPagesArgs);
            console.log(`additional-pages.pdf created at ${additionalPagesPath}`);
    
            finalSegmentPath = path.join(outputFolderPath, `updated-segment-${segmentIndex}.pdf`);
            const updatedSegmentArgs = `pdftk "${segmentPath}" "${additionalPagesPath}" cat output "${finalSegmentPath}"`;
            console.log(`Command: ${updatedSegmentArgs}`);
            await execPromise(updatedSegmentArgs);
            console.log(`updated-segment-${segmentIndex}.pdf created at ${finalSegmentPath}`);
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
            await this.cleanupFiles([impositionTexPath]);
        }
    
        return imposedPdfPath;
    }
    
    
    

    async cleanupFiles(files: string[]) {
        for (const file of files) {
            try {
                if (fs.existsSync(file)) {
                    await fs.promises.unlink(file);
                    console.log(`Deleted file: ${file}`);
                } else {
                    console.log(`File not found, so not deleted: ${file}`);
                }
            } catch (error) {
                console.error(`Failed to delete file: ${file}`, error);
            }
        }
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
                    this.plugin.templates = await this.plugin.loadTemplates(value);
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
    }
}