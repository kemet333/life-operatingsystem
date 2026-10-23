import {POST as mcpPost} from '../../mcp/route';
export const dynamic='force-dynamic';
// Owner-private service access is checked by Sites dispatch. MCP remains OAuth protected.
export async function POST(r:Request){
 const origin=r.headers.get('origin');
 if(origin&&origin!==new URL(r.url).origin)return Response.json({error:'Origen no permitido.'},{status:403});
 return mcpPost(r);
}
