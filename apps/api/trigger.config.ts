import { defineConfig } from '@trigger.dev/sdk'

const project = process.env.TRIGGER_PROJECT_REF
if (!project) throw new Error('Set TRIGGER_PROJECT_REF to deploy plan draft jobs')

export default defineConfig({
  project,
  dirs: ['./src/trigger'],
  runtime: 'node',
})
