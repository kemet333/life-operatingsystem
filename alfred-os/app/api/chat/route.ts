import {chat} from '../../../lib/alfred-chat';
export const dynamic='force-dynamic';
export async function POST(r:Request){
 const origin=r.headers.get('origin');
 if(origin&&origin!==new URL(r.url).origin)return Response.json({error:'Origen no permitido.'},{status:403});
 try{return Response.json(await chat(await r.json()));}
 catch(e){return Response.json({error:e instanceof Error?e.message:'No se ha podido enviar.'},{status:400});}
}
