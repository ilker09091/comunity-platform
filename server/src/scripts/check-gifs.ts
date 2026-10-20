/** Production diagnostic: docker compose exec -T api node dist/scripts/check-gifs.js */
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { GifsService } from '../modules/gifs/gifs.js';

// Native runs use the same private file as Compose. Never print its contents.
for(const file of ['../.env.giphy','.env.giphy','.env']) {
  if(!existsSync(file))continue;
  const values=parseEnv(readFileSync(file,'utf8'));
  for(const name of ['GIPHY_API_KEY','GIPHY_RATING','GIPHY_API_URL'])
    if(!process.env[name]?.trim()&&values[name]?.trim())process.env[name]=values[name].trim();
}

try {
  const gifs=new GifsService();
  if(!gifs.enabled)throw new Error('GIPHY_API_KEY is missing. Copy .env.giphy to the VPS project folder and recreate the api container.');
  const page=await gifs.list(undefined);
  if(!page.items.length)throw new Error('GIPHY responded but no usable GIFs were returned. Check the key and rating.');
  console.log(`GIF configuration OK: provider connected, ${page.items.length} usable GIFs. The key stays on the API server.`);
} catch(error) {
  const reason=error instanceof Error?error.message:'GIF provider check failed';
  const key=process.env.GIPHY_API_KEY?.trim();
  console.error(key?reason.replaceAll(key,'[redacted]'):reason);
  process.exitCode=1;
}
