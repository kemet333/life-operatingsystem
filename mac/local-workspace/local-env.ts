export const env = {get DB(): any { const db=(globalThis as any).__lifeLocalDB; if(!db)throw new Error('El espacio local no está listo.');return db; }};
