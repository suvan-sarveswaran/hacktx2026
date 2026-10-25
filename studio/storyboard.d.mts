export interface StoryboardChunk {
  index: number; text: string; startOffset: number; endOffset: number;
  renderHint: 'image' | 'text' | 'skip'; visualFocus: string | null;
  imagePrompt?: string; image_prompt?: string; prompt?: string;
}
export interface StoryboardLesson {script: string; chunks: StoryboardChunk[]; metadata?: object;}
export type PlannedChunk<C extends StoryboardChunk> = Omit<C,'renderHint'|'visualFocus'> & {
  renderHint:C['renderHint']|'image'|'text'; visualFocus:string|null; imagePrompt?:string;
};
export type PlannedLesson<T extends StoryboardLesson> = Omit<T,'chunks'|'metadata'> & {
  chunks:PlannedChunk<T['chunks'][number]>[];
  metadata:(T extends {metadata:infer M}?M:object) & {
    storyboard:{version:number;method:string;apiCalls:0;imageChunks:number;textChunks:number;textRatio:number;textSelection:string;scenePolicy?:string};
  };
};
export function buildStoryboard<T extends StoryboardLesson>(lesson:T):PlannedLesson<T>;
export function contextualImagePrompt(lesson:StoryboardLesson,chunk:StoryboardChunk):string;
