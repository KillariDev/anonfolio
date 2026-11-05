import type { Page } from '@playwright/test';

export async function openAddressForm(page: Page) {
  const settings = page.locator('#network-settings');
  if (await settings.evaluate(node => (node as HTMLDetailsElement).open)) await settings.locator(':scope > summary').click();
  const panel = page.locator('#address-panel');
  if (!(await panel.evaluate(node => (node as HTMLDetailsElement).open))) {
    await panel.locator('summary').click();
  }
}

export async function openTokenSettings(page: Page) {
  const settings = page.locator('#network-settings');
  if (!(await settings.evaluate(node => (node as HTMLDetailsElement).open))) {
    await settings.locator(':scope > summary').click();
  }
  const tokens = settings.locator('.token-settings');
  if (!(await tokens.evaluate(node => (node as HTMLDetailsElement).open))) {
    await tokens.locator('summary').click();
  }
}

// Deterministic UI tests replace the verifier boundary, not the production worker.
// Real Helios/proof security is exercised by verification.test.ts and opt-in live tests.
export async function mockVerification(page: Page) {
  await page.route('**/src/verification/client.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export async function verifyWallet(wallet, worker, tokens, emit) {
      const block = { hash: '0x'+'11'.repeat(32), stateRoot:'0x'+'22'.repeat(32),number:'0x100',timestamp:Date.now()-60000 };
      await Promise.all(tokens.map(async token => {
        emit({type:'asset',asset:token.address});
        const body = {jsonrpc:'2.0',id:Math.random(),method:token.address==='eth'?'eth_getBalance':'eth_call',params:token.address==='eth'?[wallet.address,'latest']:[{to:token.address,data:'0x70a08231'+wallet.address.slice(2).padStart(64,'0')},'latest']};
        for(let attempt=0;attempt<2;attempt++) {
          try {
            const response=await worker.fetch(wallet.rpcUrl,{method:'POST',body:JSON.stringify(body),anonOptions:{isolationKey:wallet.isolationKey}});
            const data=await response.json();
            emit({type:'balance',asset:token.address,amount:BigInt(data.result).toString(),block,decimals:token.decimals,decimalsVerified:true}); return;
          } catch(error) {
            if(attempt===1){emit({type:'asset-error',asset:token.address,error:String(error)});return;}
            await new Promise(resolve=>setTimeout(resolve,1000));
          }
        }
      }));
    }
  ` }));
}
