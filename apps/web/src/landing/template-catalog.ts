export const templateCatalog = [
  {
    id: 'blank',
    name: 'Blank project',
    description: 'Write the brief yourself',
    brief: '',
  },
  {
    id: 'saas',
    name: 'SaaS MVP',
    description: 'Accounts, billing, admin',
    brief: 'Describe the customer problem and the first useful release.',
  },
  {
    id: 'ml',
    name: 'ML product',
    description: 'Data pipeline, model, review',
    brief: 'Describe the problem, the available data, and how results will be reviewed.',
  },
  {
    id: 'mobile',
    name: 'Mobile app',
    description: 'iOS and Android release',
    brief: 'Describe the people using the app and the problem it solves.',
  },
  {
    id: 'commerce',
    name: 'E-commerce',
    description: 'Catalog, cart, checkout',
    brief: 'Describe the shopping experience and customer problem.',
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'Case studies, contact',
    brief: 'Describe the audience and the work to present.',
  },
] as const

export type TemplateId = (typeof templateCatalog)[number]['id']
