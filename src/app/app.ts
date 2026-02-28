import { Component, signal, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { marked } from 'marked';
import { DomSanitizer } from '@angular/platform-browser';
import { NgClass } from '@angular/common';
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

const GEMINI_API_KEY = process.env['GEMINI_API_KEY'] || '';

type AppView = 'landing' | 'writing' | 'library' | 'settings';

interface BookSection {
  id: number;
  title: string;
  content: string;
  status: 'pending' | 'generating' | 'humanizing' | 'done';
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ReactiveFormsModule, NgClass],
  templateUrl: './app.html',
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
  roles = ['نوسەر', 'ڕەخنەگر', 'پێداچونەوە', 'سەرنووسەری گۆڤار', 'لیژنەی هەڵسەنگاندن'];
  citationStyles = ['Harvard', 'APA 7th', 'MLA 9th', 'Chicago (Author-Date)', 'Chicago (Notes-Bib)', 'IEEE', 'Vancouver', 'Nature', 'Science', 'AMA'];
  referenceTypes = ['Primary Sources (توێژینەوەی بنەڕەتی)', 'Secondary Sources (پێداچوونەوە)', 'Meta-Analysis (شیکاریی گەورە)', 'Systematic Reviews', 'Archival Data (ئەرشیف)'];

  constructor() {
    this.advancedForm = this.fb.group({
      title: ['', Validators.required],
      topic: ['زانستی', Validators.required],
      type: ['کتێب', Validators.required],
      level: ['پڕۆفیسۆر', Validators.required],
      pages: [10, [Validators.required, Validators.min(1)]],
      role: ['نوسەر'],
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
  }

  ngOnInit() {
    // Initial state setup if needed
    this.currentView.set('landing');
  }

  setView(view: AppView) {
    this.currentView.set(view);
    if (view === 'writing') {
      this.writingWindow.set(1);
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
    
    const sourcesInstruction = form.customSources?.trim() 
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
      ڕۆڵ: ${form.role}
      پلەی گەرمی (داهێنان): ${form.temperature}
      
      ڕێساکانی هارڤارد کە دەبێت پەیڕەویان بکەیت:
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
