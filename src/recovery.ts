import type { Ref } from './refs';
export interface FollowUpOffer { sitting: string; ref: Ref; questions: string[] }
export function readOffer(value: unknown): FollowUpOffer | null {
  if (!value || typeof value !== 'object' || !('sitting' in value) || typeof value.sitting !== 'string' || !('ref' in value) || !value.ref || typeof value.ref !== 'object' || !('path' in value.ref) || typeof value.ref.path !== 'string' || !('blockId' in value.ref) || typeof value.ref.blockId !== 'string' || !('questions' in value) || !Array.isArray(value.questions) || !value.questions.every((q: unknown) => typeof q === 'string' && q.trim())) return null;
  return { sitting: value.sitting, ref: { path: value.ref.path, blockId: value.ref.blockId }, questions: value.questions as string[] };
}
