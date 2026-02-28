import { SupabaseService } from './supabase.service';
private supabaseService = inject(SupabaseService);
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
    } catch (error: unknown) {
      console.error('Supabase save error:', error);
      const errorMessage = error instanceof Error ? error.message : 'نەزانراو';
      this.globalError.set('هەڵەیەک ڕوویدا لە کاتی پاشەکەوتکردن لە بنکەی داتا: ' + errorMessage);
    } finally {
      this.isGeneratingGlobal.set(false);
    }
  }
