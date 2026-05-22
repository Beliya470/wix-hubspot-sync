import { TransformId } from '../types';

const TRANSFORMS: Record<NonNullable<TransformId>, (input: string) => string> = {
  trim: (s) => s.trim(),
  lowercase: (s) => s.toLowerCase(),
};

export function applyTransform(value: string | null | undefined, transform: TransformId): string | null {
  if (value === null || value === undefined) return null;
  if (!transform) return value;
  const fn = TRANSFORMS[transform];
  if (!fn) return value;
  return fn(value);
}

export const SUPPORTED_TRANSFORMS: ReadonlyArray<NonNullable<TransformId>> = ['trim', 'lowercase'];
