import Anthropic from '@anthropic-ai/sdk';

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠ ANTHROPIC_API_KEY er ikke satt — chat vil ikke fungere');
}

export const claude = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? 'placeholder',
});

export const KOMPIS_MODEL = 'claude-opus-4-7';
