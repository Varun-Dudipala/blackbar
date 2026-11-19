// JSON Schemas for on-device structured output. On-device, Firebase AI Logic
// passes only onDeviceParams.promptOptions.responseConstraint to Chrome;
// generationConfig.responseSchema is ignored there (see lab notes).

import { KINDS } from '../seal/kinds'

export const SENSITIVE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...KINDS] },
          value: { type: 'string' },
        },
        required: ['kind', 'value'],
      },
    },
  },
  required: ['items'],
} as const

export const GLANCE_SCHEMA = {
  type: 'object',
  properties: {
    documentType: { type: 'string' },
    sender: { type: 'string' },
    summary: { type: 'string' },
    asks: { type: 'array', items: { type: 'string' } },
    deadlines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { date: { type: 'string' }, what: { type: 'string' } },
        required: ['date', 'what'],
      },
    },
    amounts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { amount: { type: 'string' }, what: { type: 'string' } },
        required: ['amount', 'what'],
      },
    },
  },
  required: ['documentType', 'sender', 'summary', 'asks', 'deadlines', 'amounts'],
} as const
