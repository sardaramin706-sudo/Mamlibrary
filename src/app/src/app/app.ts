import { Component, signal, inject, OnInit, effect } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { marked } from 'marked';
import { DomSanitizer } from '@angular/platform-browser';
import { NgClass, DatePipe } from '@angular/common';
import * as DOMPurify from 'dompurify';
import { SupabaseService } from './supabase.service';

const purify = ((DOMPurify as unknown as { default: typeof DOMPurify }).default || DOMPurify) as unknown as {
  addHook: (hook: string, cb: (node: Element) => void) => void;
  sanitize: (html: string) => string;
};

if (typeof window !== 'undefined' && purify && purify.addHook) {
  purify.addHook('afterSanitizeAttributes', function (node: Element) {
    if ('target' in node) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

declare const GEMINI_API_KEY: string;

export interface BookSection {
  id: number;
  title: string;
  content: string;
  status: 'pending' | 'generating' | 'done' | 'humanizing';
}

export interface SavedDocument {
  id: number;
  title: string;
  topic: string;
  type: string;
  level: string;
  content: string;
  created_at: string;
}

type AppView = 'landing' | 'writing' | 'library' | 'seminar' | 'settings';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, NgClass, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private fb = inject(FormBuilder);
  private sanitizer = inject(DomSanitizer);
  private supabaseService = inject(SupabaseService);

  // Navigation State
  currentView = signal<AppView>('landing');
  writingWindow = signal<1 | 2>(1);

  // Advanced Form
  advancedForm: FormGroup;
  
  // Generation State
  sections = signal<BookSection[]>([]);
  activeSectionId = signal<number | null>(null);
  isGeneratingGlobal = signal(false);
  globalError = signal('');
  isAutoSelecting = signal<string | null>(null);

  // Library State
  savedDocuments = signal<SavedDocument[]>([]);
  isLoadingDocs = signal(false);

  featureGroups: Record<string, string[]> = {
    vip: ['counterArgument', 'theoreticalFramework', 'globalPerspective', 'historicalContext', 'ethicalConsiderations', 'futureImplications', 'harvardClassicTone', 'quantitativeAnalysis', 'qualitativeAnalysis', 'blindPeerReview'],
    methodology: ['mixedMethods', 'longitudinalAnalysis', 'crossSectional', 'phenomenology', 'groundedTheory'],
    logic: ['deductiveReasoning', 'inductiveReasoning', 'statisticalSignificance', 'confidenceIntervals', 'effectSize'],
    precision: ['triangulation', 'biasDetection', 'rhetoricalPrecision', 'semanticDensity', 'syntacticComplexity', 'academicHedging', 'signposting', 'footnoteDensity', 'glossaryCreation', 'appendixStructuring'],
    linguistics: ['etymology', 'philology', 'sociolinguistics', 'psycholinguistics', 'discourseAnalysis'],
    philosophy: ['utilitarianism', 'deontology', 'existentialism', 'stoicism', 'postModernism'],
    dataScience: ['bigData', 'predictiveModeling', 'networkAnalysis', 'geospatialAnalysis', 'sentimentAnalysis'],
    criticalTheory: ['marxism', 'feminism', 'postColonialism', 'structuralism', 'deconstruction'],
    scientificRigor: ['reproducibilityCheck', 'falsifiability', 'controlVariables', 'doubleBlindProtocol', 'peerDebriefing'],
    economics: ['gameTheory', 'behavioralEconomics', 'macroEconomicTrends', 'costBenefitAnalysis', 'supplyChainAnalysis'],
    psychology: ['cognitiveBehavioral', 'psychoanalysis', 'humanisticPsychology', 'socialPsychology', 'neuropsychology'],
    legal: ['internationalLaw', 'humanRights', 'intellectualProperty', 'bioethics', 'corporateGovernance']
  };

  // Dropdown Options
  topics = ['ئاینی', 'سیاسی', 'کۆمەڵایەتی', 'ئابووری', 'زانستی', 'مێژوو', 'جوگرافیا', 'ئەدەبی', 'ڕێزمان', 'زمانەوانی', 'یاسا', 'پزیشکی', 'هتد'];
  writingTypes = ['داڕشتن', 'ڕاپۆرت', 'لێکۆڵینەوەی دەرچوون', 'ماستەرنامە', 'دکتۆرانامە', 'کتێب'];
  levels = ['قوتابخانە', 'زانکۆ', 'ماستەر', 'دکتۆرا', 'پڕۆفیسۆر', 'پۆست-دکتۆرا', 'توێژەری باڵا'];
  citationStyles = ['Harvard', 'APA 7th', 'MLA 9th', 'Chicago (Author-Date)', 'Chicago (Notes-Bib)', 'IEEE', 'Vancouver', 'Nature', 'Science', 'AMA'];
  referenceTypes = ['Primary Sources (توێژینەوەی بنەڕەتی)', 'Secondary Sources (پێداچوونەوە)', 'Meta-Analysis (شیکاریی گەورە)', 'Systematic Reviews', 'Archival Data (ئەرشیف)'];

  constructor() {
    this.advancedForm = this.fb.group({
      title: ['', Validators.required],
      topic: ['زانستی', Validators.required],
      type: ['کتێب', Validators.required],
      level: ['پڕۆفیسۆر', Validators.required],
      pages: [10, [Validators.required, Validators.min(1)]],
      superRole: [false],
      dialectic: [false], // تێز دژەتێز سێنتێز
      styleText: [''], // For copy style
      compareText1: [''],
      compareText2: [''],
      compareBasis: [''],
      temperature: [0.7, [Validators.min(0), Validators.max(1)]],
      thinkingTokens: [4000],
      writingTokens: [8000],
      thesisCover: [false],
      citationStyle: ['Harvard'],
      referenceType: ['Primary Sources (توێژینەوەی بنەڕەتی)'],
      includeReferences: [true],
      dataFocus: [false],
      enableDataViz: [false],
      doiLinking: [true], // Auto-link DOIs
      crossRefCheck: [false], // Crossref validation
      plagiarismCheck: [false], // Mock plagiarism check
      
      // Custom Features
      useCustomOutline: [false],
      customOutline: [''],
      useCustomSources: [false],
      customSources: [''],
      
      // VIP Features
      counterArgument: [false],
      theoreticalFramework: [false],
      globalPerspective: [false],
      historicalContext: [false],
      ethicalConsiderations: [false],
      futureImplications: [false],
      harvardClassicTone: [false],
      quantitativeAnalysis: [false],
      qualitativeAnalysis: [false],
      blindPeerReview: [false],
      
      // Mega Expansion (20+ New Features)
      mixedMethods: [false],
      longitudinalAnalysis: [false],
      crossSectional: [false],
      phenomenology: [false],
      groundedTheory: [false],
      deductiveReasoning: [false],
      inductiveReasoning: [false],
      statisticalSignificance: [false],
      confidenceIntervals: [false],
      effectSize: [false],
      triangulation: [false],
      biasDetection: [false],
      rhetoricalPrecision: [false],
      semanticDensity: [false],
      syntacticComplexity: [false],
      academicHedging: [false],
      signposting: [false],
      footnoteDensity: [false],
      glossaryCreation: [false],
      appendixStructuring: [false],
      
      // Advanced Linguistics
      etymology: [false],
      philology: [false],
      sociolinguistics: [false],
      psycholinguistics: [false],
      discourseAnalysis: [false],
      
      // Philosophical Lenses
      utilitarianism: [false],
      deontology: [false],
      existentialism: [false],
      stoicism: [false],
      postModernism: [false],
      
      // Data Science
      bigData: [false],
      predictiveModeling: [false],
      networkAnalysis: [false],
      geospatialAnalysis: [false],
      sentimentAnalysis: [false],
      
      // Critical Theory
      marxism: [false],
      feminism: [false],
      postColonialism: [false],
      structuralism: [false],
      deconstruction: [false],
      
      // Scientific Rigor
      reproducibilityCheck: [false],
      falsifiability: [false],
      controlVariables: [false],
      doubleBlindProtocol: [false],
      peerDebriefing: [false],
      
      // Economic Models
      gameTheory: [false],
      behavioralEconomics: [false],
      macroEconomicTrends: [false],
      costBenefitAnalysis: [false],
      supplyChainAnalysis: [false],
      
      // Psychological Frameworks
      cognitiveBehavioral: [false],
      psychoanalysis: [false],
      humanisticPsychology: [false],
      socialPsychology: [false],
      neuropsychology: [false],
      
      // Legal & Ethical
      internationalLaw: [false],
      humanRights: [false],
      intellectualProperty: [false],
      bioethics: [false],
      corporateGovernance: [false]
    });

    // Auto-save to LocalStorage
    effect(() => {
      const currentSections = this.sections();
      const currentForm = this.advancedForm.value;
      if (currentSections.length > 0) {
        localStorage.setItem('mamlibrary_autosave', JSON.stringify({
          sections: currentSections,
          form: currentForm
        }));
      }
    });
  }

  async autoSelectFeatures(groupName: string, groupKeys: string[]) {
    const title = this.advancedForm.get('title')?.value;
    const type = this.advancedForm.get('type')?.value;
    const level = this.advancedForm.get('level')?.value;

    if (!title) {
      this.globalError.set('تکایە سەرەتا ناونیشانی بابەتەکە بنووسە.');
      return;
    }

    this.isAutoSelecting.set(groupName);
    this.globalError.set('');

    try {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const prompt = `
      You are an expert academic advisor at Harvard University.
      I am writing a ${level} level ${type} titled "${title}".
      
      I have a group of advanced academic features: ${groupKeys.join(', ')}.
      
      Based on the title, type, and level, select the MOST RELEVANT features from this list that would genuinely improve the quality of this specific work. Return ONLY a valid JSON array of strings containing the exact keys of the selected features. Do not include any markdown formatting, just the raw JSON array. For example: ["feature1", "feature2"]
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        }
      });

      const text = response.text || '[]';
      const selectedKeys: string[] = JSON.parse(text);

      // Reset all in group to false first
      groupKeys.forEach(key => {
        this.advancedForm.get(key)?.setValue(false);
      });

      // Set selected to true
      selectedKeys.forEach(key => {
        if (this.advancedForm.get(key)) {
          this.advancedForm.get(key)?.setValue(true);
        }
      });

    } catch (error: unknown) {
      console.error('Auto-select error:', error);
      this.globalError.set('هەڵەیەک ڕوویدا لە کاتی هەڵبژاردنی ئۆتۆماتیکی.');
    } finally {
      this.isAutoSelecting.set(null);
    }
  }

  clearSections() {
    this.sections.set([]);
    this.activeSectionId.set(null);
    localStorage.removeItem('mamlibrary_autosave');
  }

  ngOnInit() {
    // Initial state setup if needed
    this.currentView.set('landing');
    
    // Load auto-saved draft if exists
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('mamlibrary_autosave');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const savedSections = Array.isArray(parsed) ? parsed : parsed.sections;
          const savedForm = Array.isArray(parsed) ? null : parsed.form;

          if (savedSections && savedSections.length > 0) {
            this.sections.set(savedSections);
            if (savedForm) {
              this.advancedForm.patchValue(savedForm);
            }
            this.activeSectionId.set(savedSections[0].id);
            this.writingWindow.set(2);
            this.currentView.set('writing');
          }
        } catch (e) {
          console.error('Failed to load auto-save', e);
        }
      }
    }
  }

  setView(view: AppView) {
    this.currentView.set(view);
    if (view === 'writing') {
      this.writingWindow.set(1);
    } else if (view === 'library') {
      this.loadDocuments();
    }
  }

  async loadDocuments() {
    this.isLoadingDocs.set(true);
    this.globalError.set('');
    try {
      const { data, error } = await this.supabaseService.getDocuments();
      if (error) throw error;
      this.savedDocuments.set((data as SavedDocument[]) || []);
    } catch (error: unknown) {
      console.error('Error loading documents:', error);
      this.globalError.set('هەڵەیەک ڕوویدا لە هێنانەوەی توێژینەوەکان لە بنکەی داتا.');
    } finally {
      this.isLoadingDocs.set(false);
    }
  }

  readDocument(doc: SavedDocument) {
    try {
      const parsedSections = JSON.parse(doc.content);
      this.sections.set(parsedSections);
      this.advancedForm.patchValue({
        title: doc.title,
        topic: doc.topic,
        type: doc.type,
        level: doc.level
      });
      this.activeSectionId.set(parsedSections[0]?.id || null);
      this.writingWindow.set(2);
      this.setView('writing');
    } catch {
      this.globalError.set('هەڵەیەک ڕوویدا لە خوێندنەوەی ناوەڕۆکی توێژینەوەکە.');
    }
  }

  async deleteDocument(id: number) {
    if (!confirm('ئایا دڵنیایت لە سڕینەوەی ئەم توێژینەوەیە بە یەکجاری؟')) return;
    
    this.globalError.set('');
    try {
      const { error } = await this.supabaseService.deleteDocument(id);
      if (error) throw error;
      
      // Remove from local state
      this.savedDocuments.update(docs => docs.filter(d => d.id !== id));
      alert('بە سەرکەوتوویی سڕایەوە.');
    } catch (error: unknown) {
      console.error('Error deleting document:', error);
      this.globalError.set('هەڵەیەک ڕوویدا لە سڕینەوەی توێژینەوەکە.');
    }
  }

  // Window 1 -> Window 2 Transition
  async sendToWindow2() {
    if (this.advancedForm.invalid) {
      this.globalError.set('تکایە هەموو زانیارییە داواکراوەکان پڕبکەرەوە.');
      return;
    }

    this.globalError.set('');
    this.isGeneratingGlobal.set(true);

    try {
      const form = this.advancedForm.value;
      const pages = form.pages;
      
      // Check if custom outline is enabled and provided
      if (form.useCustomOutline && form.customOutline?.trim()) {
        const lines = form.customOutline.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
        const customSections: BookSection[] = lines.map((title: string, index: number) => ({
          id: index + 1,
          title: title,
          content: '',
          status: 'pending'
        }));
        
        if (customSections.length > 0) {
          this.sections.set(customSections);
          this.activeSectionId.set(customSections[0].id);
          this.writingWindow.set(2);
          this.isGeneratingGlobal.set(false);
          return;
        }
      }

      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const prompt = `
      تۆ سەرنووسەرێکی باڵای چاپخانەی زانکۆی هارڤارد (Harvard University Press)یت.
      تکایە پێکهاتە و ناونیشانی بەشەکانی ئەم بەرهەمە دابڕێژە بە ستانداردی توندی ئەکادیمی هارڤارد:
      ناونیشان: ${form.title}
      بابەت: ${form.topic}
      جۆر: ${form.type}
      ئاست: ${form.level}
      قەبارە: ${form.pages} لاپەڕە
      
      تەنها ناونیشانی بەشەکانم بدەرێ بە شێوەی لیستێکی ژمارەیی، بێ هیچ قسەیەکی زیادە. با ژمارەی بەشەکان گونجاو بێت بۆ ئەم قەبارەیە.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        config: { temperature: 0.3 }
      });

      const outlineText = response.text || '';
      const lines = outlineText.split('\n').filter(l => l.trim().length > 0);
      
      const newSections: BookSection[] = lines.map((line, index) => ({
        id: index + 1,
        title: line.replace(/^\d+[.-]/, '').trim(),
        content: '',
        status: 'pending'
      }));

      // Fallback if AI didn't format well
      if (newSections.length === 0) {
        for(let i=1; i<=Math.max(3, Math.ceil(pages/5)); i++) {
          newSections.push({ id: i, title: `بەشی ${i}`, content: '', status: 'pending' });
        }
      }

      this.sections.set(newSections);
      this.activeSectionId.set(newSections[0].id);
      this.writingWindow.set(2);

    } catch {
      this.globalError.set('هەڵەیەک ڕوویدا لە داڕشتنی پێکهاتەکە.');
    } finally {
      this.isGeneratingGlobal.set(false);
    }
  }

  viewSection(id: number) {
    this.activeSectionId.set(id);
  }

  addNewSection() {
    const current = this.sections();
    const newId = current.length > 0 ? Math.max(...current.map(s => s.id)) + 1 : 1;
    this.sections.update(s => [...s, { id: newId, title: 'بەشی نوێ', content: '', status: 'pending' }]);
  }

  removeSection(id: number, event: Event) {
    event.stopPropagation();
    if(confirm('ئایا دڵنیایت لە سڕینەوەی ئەم بەشە؟')) {
      this.sections.update(s => s.filter(sec => sec.id !== id));
      if (this.activeSectionId() === id) {
        this.activeSectionId.set(this.sections()[0]?.id || null);
      }
    }
  }

  updateSectionTitle(id: number, event: Event) {
    const newTitle = (event.target as HTMLInputElement).value;
    this.sections.update(s => s.map(sec => sec.id === id ? { ...sec, title: newTitle } : sec));
  }

  getActiveSectionContent() {
    const id = this.activeSectionId();
    const section = this.sections().find(s => s.id === id);
    if (!section || !section.content) return '';
    
    try {
      const rawHtml = marked.parse(section.content, { async: false }) as string;
      const cleanHtml = purify.sanitize(rawHtml);
      return this.sanitizer.bypassSecurityTrustHtml(cleanHtml);
    } catch {
      return section.content;
    }
  }

  // Auto-Write All Sections Sequentially
  async autoWrite() {
    if (this.isGeneratingGlobal()) return;
    this.isGeneratingGlobal.set(true);
    this.globalError.set('');

    const form = this.advancedForm.value;
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    const sourcesInstruction = (form.useCustomSources && form.customSources?.trim()) 
      ? `\n\nڕێنمایی زۆر گرنگ (CRITICAL): تۆ دەبێت تەنها و تەنها ئەم سەرچاوانەی خوارەوە بەکاربهێنیت بۆ وەرگرتنی زانیاری. بە هیچ شێوەیەک زانیاری لە دەرەوەی ئەم سەرچاوانە مەهێنە. ئەگەر زانیارییەکە لەم سەرچاوانەدا نەبوو، بڵێ کە بەردەست نییە.\nسەرچاوەکان:\n${form.customSources}\n` 
      : '';

    let previousContext = '';

    for (let i = 0; i < this.sections().length; i++) {
      const section = this.sections()[i];
      
      // Update status
      this.sections.update(secs => {
        const newSecs = [...secs];
        newSecs[i].status = 'generating';
        return newSecs;
      });
      this.activeSectionId.set(section.id);

      const prompt = `
      تۆ پڕۆفیسۆرێکی باڵا و سەرنووسەری چاپخانەی زانکۆی هارڤارد (Harvard University Press)یت.
      تۆ خەریکی نووسینی ئەم بەرهەمەیت بەپێی ستانداردە توندەکانی هارڤارد:
      ناونیشانی گشتی: ${form.title}
      بابەت: ${form.topic}
      جۆر: ${form.type}
      ئاست: ${form.level}
      پلەی گەرمی (داهێنان): ${form.temperature}
      
      ڕێنماییە زۆر توندەکان بۆ سڕینەوەی مۆرکی ئامێر (ZERO AI FOOTPRINT) - ئەگەر ئەمە جێبەجێ نەکەیت دەقەکە ڕەتدەکرێتەوە:
      ١. بە هیچ شێوەیەک نابێت هەست بکرێت کە زیرەکی دەستکرد ئەمەی نووسیوە. دەبێت سەدا سەد مرۆڤانە و لە ئاستی پڕۆفیسۆرێکی دێرینی هارڤارد بێت.
      ٢. قەدەغەکردنی وشە سواوەکانی AI: هەرگیز ئەم دەستەواژانە بەکارمەهێنە: (لە کۆتاییدا، گرنگە بزانین، جێگای سەرنجە، بە کورتی، دەتوانین بڵێین، لەم ڕوانگەیەوە، پێویستە ئاماژە بەوە بکەین، بە دڵنیاییەوە، بێگومان).
      ٣. شێوازی داڕشتن: ڕستەکانت با درێژی و کورتییان جیاواز بێت بۆ ئەوەی ڕیتمێکی سروشتی مرۆڤانەی هەبێت. خۆت بپارێزە لە ڕیزبەندییە یەکسانە بێزارکەرەکان (بۆ نموونە هەمیشە ٣ خاڵ یان ٣ پەرەگراف).
      ٤. تۆنی نووسین: زۆر وشک، زانستی، بێلایەن، و بێ سۆز. هیچ وشەیەکی موبالەغە (وەک: زۆر گرنگە، سەرسوڕهێنەرە، بێوێنەیە) بەکارمەهێنە.
      ٥. چڕیی واتایی: لەبری ئەوەی قسە درێژ بکەیتەوە، زانیارییەکان زۆر بە چڕی و بەکارهێنای زاراوەی قورسی ئەکادیمی دابڕێژە.
      
      ڕێساکانی هارڤارد کە دەبێت پەیڕەویان بکەیت:
      ${form.superRole ? '٠. (زۆر گرنگ): تۆ لە یەک کاتدا نووسەرێکی بلیمەت، ڕەخنەگرێکی زۆر توند، و پێداچوونەوەکارێکی وردبینی. دەبێت ئەم دەقە بە شێوەیەک بنووسیت کە پێشتر نووسرابێت، ڕەخنەی توندی لێگیرابێت، و بە تەواوی پاڵفتە کرابێت و هیچ کەلێنێکی تێدا نەمابێت.' : ''}
      ١. زمانی نووسین دەبێت زۆر فەرمی، ئەکادیمی، و بێلایەن بێت.
      ٢. دوورکەوتنەوە لە وشەی سۆزداری و دەربڕینی کەسی.
      ٣. هەموو ئیدیعایەک دەبێت بە بەڵگە و لۆژیک بسەلمێنرێت.
      
      ${form.dialectic ? '٤. تکایە شێوازی (تێز، دژەتێز، سێنتێز) بەکاربهێنە لە شیکارییەکانتدا.' : ''}
      ${form.includeReferences ? `٥. پێویستە سەرچاوەکان بەکاربهێنیت بە شێوازی ${form.citationStyle}.` : ''}
      ${form.includeReferences ? `٦. تەنها پشت بەم جۆرە سەرچاوانە ببەستە: ${form.referenceType}.` : ''}
      ${form.dataFocus ? '٧. تکایە پشت بە ئامار و داتای زانستی و ڕاستەقینە ببەستە.' : ''}
      ${form.doiLinking ? '٨. بۆ هەر سەرچاوەیەک کە بەکاریدەهێنیت، تکایە لینکی DOI (Digital Object Identifier) یان URL ی فەرمی دابنێ ئەگەر بەردەست بوو.' : ''}
      
      تایبەتمەندییە VIP و پێشکەوتووەکان کە دەبێت ڕەچاویان بکەیت:
      ${form.counterArgument ? '- بۆ هەر ئارگیومێنتێکی سەرەکی، دژە-ئارگیومێنتێکی (Counter-argument) بەهێز بهێنەوە و پاشان بە لۆژیکێکی پۆڵاین پووچەڵی بکەرەوە.' : ''}
      ${form.theoreticalFramework ? '- بابەتەکە ببەستەوە بە چوارچێوەیەکی تیۆری (Theoretical Framework) ناسراو و قووڵ لەو بوارەدا.' : ''}
      ${form.globalPerspective ? '- کێشەکە لە ڕوانگەیەکی جیهانی و نێودەوڵەتییەوە (Global Perspective) شی بکەرەوە، نەک تەنها ناوخۆیی.' : ''}
      ${form.historicalContext ? '- پێشینە و پاشخانی مێژوویی (Historical Context) بابەتەکە بە قووڵی ڕوون بکەرەوە بۆ تێگەیشتنی ڕەگ و ڕیشەی کێشەکە.' : ''}
      ${form.ethicalConsiderations ? '- لایەنە ئاکاری و ئەخلاقییەکانی (Ethical Considerations) پەیوەست بەم بابەتە بەوردی تاوتوێ بکە.' : ''}
      ${form.futureImplications ? '- دەرئەنجامەکان و پێشبینییەکان بۆ داهاتوو (Future Implications) بە پشتبەستن بە داتای ئێستا بخەڕوو.' : ''}
      ${form.harvardClassicTone ? '- تۆنی نووسینەکەت با کلاسیکی و زۆر قورسی هارڤارد بێت، بەکارهێنانی وشەسازی ئاڵۆز، فەلسەفی، و ڕستەی درێژی ئەکادیمی.' : ''}
      ${form.quantitativeAnalysis ? '- شیکارییەکانت بە شێوازی چەندایەتی (Quantitative) و پشت بەستوو بە داتای ژمارەیی و ئاماری بیرکاری بکە.' : ''}
      ${form.qualitativeAnalysis ? '- شیکارییەکانت بە شێوازی چۆنایەتی (Qualitative) و قووڵبوونەوە لە ماناکان، هۆکارەکان، و پاڵنەرەکان بکە.' : ''}
      
      تایبەتمەندییە نوێیەکان (Mega Expansion):
      ${form.mixedMethods ? '- بەکارهێنانی ڕێبازی تێکەڵ (Mixed Methods) بۆ شیکردنەوەی داتا.' : ''}
      ${form.longitudinalAnalysis ? '- ئەنجامدانی شیکاری درێژخایەن (Longitudinal Analysis) بۆ دەرخستنی گۆڕانکارییەکان بەپێی کات.' : ''}
      ${form.crossSectional ? '- شیکاری بەراوردکاری (Cross-Sectional) لە نێوان گرووپە جیاوازەکاندا.' : ''}
      ${form.phenomenology ? '- بەکارهێنانی ڕێبازی دیاردەناسی (Phenomenology) بۆ تێگەیشتن لە ئەزموونی زیندوو.' : ''}
      ${form.groundedTheory ? '- بەکارهێنانی تیۆری بنچینەیی (Grounded Theory) بۆ دەرھێنانی تیۆری لە داتاکانەوە.' : ''}
      ${form.deductiveReasoning ? '- بەکارهێنانی لۆژیکی دابەزین (Deductive Reasoning) لە گشتییەوە بۆ تایبەت.' : ''}
      ${form.inductiveReasoning ? '- بەکارهێنانی لۆژیکی هەڵکشان (Inductive Reasoning) لە تایبەتەوە بۆ گشتی.' : ''}
      ${form.statisticalSignificance ? '- جەختکردنەوە لەسەر واتای ئاماری (Statistical Significance) و بەهای P-value.' : ''}
      ${form.confidenceIntervals ? '- دیاریکردنی مەودای متمانە (Confidence Intervals) بۆ هەموو خەمڵاندنەکان.' : ''}
      ${form.effectSize ? '- ڕاپۆرتکردنی قەبارەی کاریگەری (Effect Size) بۆ نیشاندانی هێزی پەیوەندییەکان.' : ''}
      ${form.triangulation ? '- بەکارهێنانی سێگۆشەکردن (Triangulation) بۆ پشتڕاستکردنەوەی داتا لە چەند سەرچاوەیەکەوە.' : ''}
      ${form.biasDetection ? '- دەستنیشانکردن و کەمکردنەوەی لایەنگیری (Bias Detection & Mitigation).' : ''}
      ${form.rhetoricalPrecision ? '- بەکارهێنانی وردبینی ڕەوانبێژی (Rhetorical Precision) لە هەڵبژاردنی وشەکاندا.' : ''}
      ${form.semanticDensity ? '- چڕیی واتایی (Semantic Density) بەرز بێت، واتە زانیاری زۆر لە وشەی کەمدا.' : ''}
      ${form.syntacticComplexity ? '- ئاڵۆزی ڕستەسازی (Syntactic Complexity) بۆ نیشاندانی پەیوەندییە ئاڵۆزەکان.' : ''}
      ${form.academicHedging ? '- بەکارهێنانی وریایی ئەکادیمی (Hedging) بۆ دوورکەوتنەوە لە گشتاندنی ناڕاست.' : ''}
      ${form.signposting ? '- بەکارهێنانی نیشانەدانان (Signposting) بۆ ڕێنماییکردنی خوێنەر لەناو دەقەکەدا.' : ''}
      ${form.footnoteDensity ? '- بەکارهێنانی پەراوێزی زۆر (High Footnote Density) بۆ ڕوونکردنەوەی زیادە.' : ''}
      ${form.glossaryCreation ? '- ئامادەکردنی فەرهەنگۆک (Glossary) بۆ زاراوە تەکنیکییەکان.' : ''}
      ${form.appendixStructuring ? '- ڕێکخستنی پاشکۆکان (Appendix Structuring) بۆ داتای زیادە.' : ''}
      
      تایبەتمەندییە نوێیەکان (Super Mega Expansion):
      ${form.etymology ? '- بەکارهێنانی ڕەچەڵەکناسی (Etymology) بۆ شیکردنەوەی وشەکان.' : ''}
      ${form.philology ? '- بەکارهێنانی فیلۆلۆجی (Philology) بۆ خوێندنەوەی دەقە کۆنەکان.' : ''}
      ${form.sociolinguistics ? '- شیکردنەوەی زمانەوانی کۆمەڵایەتی (Sociolinguistics).' : ''}
      ${form.psycholinguistics ? '- شیکردنەوەی زمانەوانی دەروونی (Psycholinguistics).' : ''}
      ${form.discourseAnalysis ? '- شیکاری گوتار (Discourse Analysis) بۆ تێگەیشتن لە دەق.' : ''}
      ${form.utilitarianism ? '- بەکارهێنانی فەلسەفەی سوودگەرایی (Utilitarianism).' : ''}
      ${form.deontology ? '- بەکارهێنانی فەلسەفەی ئەرکگەرایی (Deontology).' : ''}
      ${form.existentialism ? '- بەکارهێنانی فەلسەفەی بوونیەتگەرایی (Existentialism).' : ''}
      ${form.stoicism ? '- بەکارهێنانی فەلسەفەی ستۆیسیزم (Stoicism).' : ''}
      ${form.postModernism ? '- بەکارهێنانی فەلسەفەی پۆست-مۆدێرنیزم (Post-Modernism).' : ''}
      ${form.bigData ? '- بەکارهێنانی داتای گەورە (Big Data) لە شیکارییەکاندا.' : ''}
      ${form.predictiveModeling ? '- بەکارهێنانی مۆدێلی پێشبینیکەر (Predictive Modeling).' : ''}
      ${form.networkAnalysis ? '- شیکاری تۆڕ (Network Analysis) بۆ پەیوەندییەکان.' : ''}
      ${form.geospatialAnalysis ? '- شیکاری شوێن-كات (Geospatial Analysis).' : ''}
      ${form.sentimentAnalysis ? '- شیکاری هەست (Sentiment Analysis) بۆ دەقەکان.' : ''}
      ${form.marxism ? '- بەکارهێنانی تیۆری مارکسیزم (Marxism) بۆ شیکردنەوە.' : ''}
      ${form.feminism ? '- بەکارهێنانی تیۆری فێمینیزم (Feminism) بۆ شیکردنەوە.' : ''}
      ${form.postColonialism ? '- بەکارهێنانی تیۆری پۆست-کۆلۆنیالیزم (Post-Colonialism).' : ''}
      ${form.structuralism ? '- بەکارهێنانی تیۆری بونیادگەری (Structuralism).' : ''}
      ${form.deconstruction ? '- بەکارهێنانی تیۆری هەڵوەشاندنەوە (Deconstruction).' : ''}
      ${form.reproducibilityCheck ? '- دڵنیابوونەوە لە دووبارەکرانەوەی ئەنجامەکان (Reproducibility Check).' : ''}
      ${form.falsifiability ? '- دڵنیابوونەوە لە هەڵوەشێنەرەوەی گریمانەکان (Falsifiability).' : ''}
      ${form.controlVariables ? '- دیاریکردنی گۆڕاوە کۆنترۆڵکراوەکان (Control Variables).' : ''}
      ${form.doubleBlindProtocol ? '- بەکارهێنانی پڕۆتۆکۆلی کوێرانە (Double-Blind Protocol).' : ''}
      ${form.peerDebriefing ? '- بەکارهێنانی گفتوگۆی هاوەڵان (Peer Debriefing).' : ''}
      ${form.gameTheory ? '- بەکارهێنانی تیۆری یاری (Game Theory).' : ''}
      ${form.behavioralEconomics ? '- بەکارهێنانی ئابووری ڕەفتاری (Behavioral Economics).' : ''}
      ${form.macroEconomicTrends ? '- شیکردنەوەی ترێندە ماکرۆکان (Macro-Economic Trends).' : ''}
      ${form.costBenefitAnalysis ? '- شیکاری تێچوو-سوود (Cost-Benefit Analysis).' : ''}
      ${form.supplyChainAnalysis ? '- شیکاری زنجیرەی دابینکردن (Supply Chain Analysis).' : ''}
      ${form.cognitiveBehavioral ? '- بەکارهێنانی چوارچێوەی مەعریفی ڕەفتاری (CBT).' : ''}
      ${form.psychoanalysis ? '- بەکارهێنانی شیکاری دەروونی (Psychoanalysis).' : ''}
      ${form.humanisticPsychology ? '- بەکارهێنانی دەروونناسی مرۆیی (Humanistic Psychology).' : ''}
      ${form.socialPsychology ? '- بەکارهێنانی دەروونناسی کۆمەڵایەتی (Social Psychology).' : ''}
      ${form.neuropsychology ? '- بەکارهێنانی دەروونناسی دەمار (Neuropsychology).' : ''}
      ${form.internationalLaw ? '- بەکارهێنانی یاسای نێودەوڵەتی (International Law).' : ''}
      ${form.humanRights ? '- جەختکردنەوە لەسەر مافی مرۆڤ (Human Rights).' : ''}
      ${form.intellectualProperty ? '- پاراستنی موڵکیەتی هزری (Intellectual Property).' : ''}
      ${form.bioethics ? '- ڕەچاوکردنی ئاکاری ژیانی (Bioethics).' : ''}
      ${form.corporateGovernance ? '- شیکردنەوەی حوکمڕانی کۆمپانیا (Corporate Governance).' : ''}
      ${sourcesInstruction}
      
      ئێستا تکایە تەنها ئەم بەشە بنووسە بە تێروتەسەلی و ئاستێکی باڵای ئەکادیمی هارڤارد:
      ناونیشانی بەش: ${section.title}
      
      ${previousContext ? `پوختەی بەشی پێشوو بۆ بەستنەوەی زنجیرەیی: ${previousContext}` : ''}
      `;

      try {
        const response = await ai.models.generateContentStream({
          model: 'gemini-3.1-pro-preview',
          contents: prompt,
          config: {
            temperature: form.temperature,
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
            tools: [{ googleSearch: {} }]
          }
        });

        let fullContent = '';
        for await (const chunk of response) {
          fullContent += chunk.text;
          this.sections.update(secs => {
            const newSecs = [...secs];
            newSecs[i].content = fullContent;
            return newSecs;
          });
        }

        // Update status to done
        this.sections.update(secs => {
          const newSecs = [...secs];
          newSecs[i].status = 'done';
          return newSecs;
        });

        // Save last 500 chars for context chaining
        previousContext = fullContent.slice(-500);

      } catch {
        this.globalError.set(`هەڵە لە نووسینی بەشی ${section.title}`);
        this.sections.update(secs => {
          const newSecs = [...secs];
          newSecs[i].status = 'pending';
          return newSecs;
        });
        break; // Stop auto-write on error
      }
    }

    this.isGeneratingGlobal.set(false);
  }

  // Auto-Humanize
  async autoHumanize() {
    if (this.isGeneratingGlobal()) return;
    this.isGeneratingGlobal.set(true);
    
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const form = this.advancedForm.value;
    const sourcesInstruction = (form.useCustomSources && form.customSources?.trim()) 
      ? `\n\nڕێنمایی زۆر گرنگ (CRITICAL): تۆ دەبێت تەنها و تەنها ئەم سەرچاوانەی خوارەوە بەکاربهێنیت بۆ وەرگرتنی زانیاری. بە هیچ شێوەیەک زانیاری لە دەرەوەی ئەم سەرچاوانە مەهێنە.\nسەرچاوەکان:\n${form.customSources}\n` 
      : '';

    for (let i = 0; i < this.sections().length; i++) {
      const section = this.sections()[i];
      if (!section.content) continue;

      this.sections.update(secs => {
        const newSecs = [...secs];
        newSecs[i].status = 'humanizing';
        return newSecs;
      });
      this.activeSectionId.set(section.id);

      const prompt = `
      تۆ پڕۆفیسۆرێکی باڵا و سەرنووسەری چاپخانەی زانکۆی هارڤارد (Harvard University Press)یت.
      تکایە ئەم دەقە دابڕێژەوە (Humanize) بۆ ئەوەی هەستی مرۆڤانەی پێوە دیار بێت، بەڵام لە هەمان کاتدا پارێزگاری لە ستانداردی توندی ئەکادیمی هارڤارد بکە.
      وشە ئاڵۆزەکانی ئامێرەکان لاببە، هەستی مرۆڤانە و ڕستەسازی سروشتی بەکاربهێنە، بەڵام با زمانەکە بێلایەن و زانستی بمێنێتەوە:
      ${sourcesInstruction}
      
      ${section.content}
      `;

      try {
        const response = await ai.models.generateContentStream({
          model: 'gemini-3.1-pro-preview',
          contents: prompt,
          config: { temperature: 0.8 }
        });

        let fullContent = '';
        for await (const chunk of response) {
          fullContent += chunk.text;
          this.sections.update(secs => {
            const newSecs = [...secs];
            newSecs[i].content = fullContent;
            return newSecs;
          });
        }

        this.sections.update(secs => {
          const newSecs = [...secs];
          newSecs[i].status = 'done';
          return newSecs;
        });

      } catch {
        this.globalError.set(`هەڵە لە هیومانیزکردنی بەشی ${section.title}`);
        break;
      }
    }

    this.isGeneratingGlobal.set(false);
  }

  // Academic Peer Review
  async academicReview() {
    if (this.isGeneratingGlobal()) return;
    const id = this.activeSectionId();
    const sectionIndex = this.sections().findIndex(s => s.id === id);
    if (sectionIndex === -1 || !this.sections()[sectionIndex].content) return;

    this.isGeneratingGlobal.set(true);
    this.globalError.set('');
    
    this.sections.update(secs => {
      const newSecs = [...secs];
      newSecs[sectionIndex].status = 'humanizing'; // Reusing spinner state
      return newSecs;
    });

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const form = this.advancedForm.value;
    const isBlindReview = form.blindPeerReview;
    
    const sourcesInstruction = (form.useCustomSources && form.customSources?.trim()) 
      ? `\n\nڕێنمایی زۆر گرنگ (CRITICAL): لە کاتی پێداچوونەوە و ڕاستکردنەوەی زانیارییەکان، تەنها پشت بەم سەرچاوانە ببەستە. بە هیچ شێوەیەک زانیاری لە دەرەوەی ئەم سەرچاوانە مەهێنە.\nسەرچاوەکان:\n${form.customSources}\n` 
      : '';
    
    const prompt = `
    تۆ لیژنەی باڵای هەڵسەنگاندنی چاپخانەی زانکۆی هارڤارد (Harvard University Press)یت.
    تکایە پێداچوونەوەیەکی ڕەخنەگرانەی زۆر توند (Rigorous Peer Review) بۆ ئەم دەقە بکە.
    ${isBlindReview ? 'ئەمە پێداچوونەوەیەکی کوێرانەیە (Double-Blind Peer Review). تکایە زۆر بێبەزەییانە و توند بە لەسەر هەڵە زانستییەکان و هیچ سازشێک مەکە.' : ''}
    کەموکوڕییە زانستییەکان، لۆژیکییەکان، و ڕێزمانییەکان چاک بکە.
    گرنگترین خاڵ: پێداچوونەوەیەکی ورد بۆ سەرچاوەکان بکە. ئایا سەرچاوەکان باوەڕپێکراون؟ ئایا ستایلی ${this.advancedForm.value.citationStyle} بە دروستی بەکارهاتووە؟
    دەقەکە بەرز بکەرەوە بۆ ئاستی بڵاوکردنەوەی ئەکادیمی لە چاپخانەی هارڤارد (Q1 Journal Standard):
    ${sourcesInstruction}
    
    ${this.sections()[sectionIndex].content}
    `;

    try {
      const response = await ai.models.generateContentStream({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        config: { temperature: 0.4, thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } }
      });

      let fullContent = '';
      for await (const chunk of response) {
        fullContent += chunk.text;
        this.sections.update(secs => {
          const newSecs = [...secs];
          newSecs[sectionIndex].content = fullContent;
          return newSecs;
        });
      }

      this.sections.update(secs => {
        const newSecs = [...secs];
        newSecs[sectionIndex].status = 'done';
        return newSecs;
      });
    } catch {
      this.globalError.set('هەڵە لە پێداچوونەوەی ئەکادیمیدا.');
    }
    this.isGeneratingGlobal.set(false);
  }

  // Export as LaTeX
  exportLatex() {
    const form = this.advancedForm.value;
    let latex = `\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\title{${form.title}}\n\\author{کتێبخانەی مام}\n\\begin{document}\n\\maketitle\n\n`;
    
    for (const section of this.sections()) {
      latex += `\\section{${section.title}}\n${section.content}\n\n`;
    }
    latex += `\\end{document}`;
    
    const blob = new Blob(['\ufeff', latex], { type: 'application/x-tex' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form.title || 'document'}.tex`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Save All as DOC
  saveAll() {
    const form = this.advancedForm.value;
    let content = `<h1>${form.title}</h1>\n\n`;
    
    for (const section of this.sections()) {
      content += `<h2>${section.title}</h2>\n${section.content}\n\n`;
    }

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>${form.title}</title></head><body>${content}</body></html>
    `;

    const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form.title || 'document'}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async saveToSupabase() {
    if (this.isGeneratingGlobal()) return;
    this.isGeneratingGlobal.set(true);
    this.globalError.set('');

    try {
      const form = this.advancedForm.value;
      const documentData = {
        title: form.title,
        topic: form.topic,
        type: form.type,
        level: form.level,
        content: JSON.stringify(this.sections()),
        created_at: new Date().toISOString()
      };

      const { error } = await this.supabaseService.client
        .from('documents')
        .insert([documentData]);

      if (error) {
        throw error;
      }

      alert('بە سەرکەوتوویی لە بنکەی داتا (Supabase) پاشەکەوت کرا!');
      // Refresh library if we are on it
      if (this.currentView() === 'library') {
        this.loadDocuments();
      }
    } catch (error: unknown) {
      console.error('Supabase save error:', error);
      const errorMessage = error instanceof Error ? error.message : 'نەزانراو';
      this.globalError.set('هەڵەیەک ڕوویدا لە کاتی پاشەکەوتکردن لە بنکەی داتا: ' + errorMessage);
    } finally {
      this.isGeneratingGlobal.set(false);
    }
  }

  // File Input Handlers (Mocking text extraction for UI purposes)
  onFileChange(event: Event, controlName: string) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.advancedForm.get(controlName)?.setValue(`[فایل هەڵبژێردرا: ${file.name}]`);
    }
  }
}
