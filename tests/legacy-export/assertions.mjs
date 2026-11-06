import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import ts from 'typescript';

export function assertNoSecrets(value,secrets,label) {
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value));
  for (const secret of secrets) assert.equal(bytes.includes(Buffer.from(secret)),false,`${label} contains planted credential ${secrets.indexOf(secret)+1}`);
}

export async function assertArtifact(file,secrets) {
  const contents=await readFile(file,'utf8');
  assertNoSecrets(contents,secrets,file);
  const bundle=JSON.parse(contents);
  for (const object of bundle.objects||[]) assertNoSecrets(Buffer.from(object.dataBase64,'base64'),secrets,`${file} decoded attachment`);
  return bundle;
}

export async function assertAllNativeStores(env,secrets,persist) {
  // D1 refuses reads of its internal _cf_METADATA via the API. Inspect the real
  // persisted databases directly so no table is exempt from the leak assertion.
  const directory=join(persist,'v3/d1/miniflare-D1DatabaseObject');
  const files=(await readdir(directory)).filter(name=>name.endsWith('.sqlite'));
  assert.ok(files.length,'native D1 databases exist');
  for (const file of files) {
    const db=new DatabaseSync(join(directory,file),{readOnly:true});
    try {
      for (const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
        const rows=db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all();
        assertNoSecrets(name,secrets,'native table name');
        assertNoSecrets(rows,secrets,`native D1 ${name}`);
      }
    } finally {db.close();}
  }
  let cursor;
  do {
    const page=await env.FILES.list(cursor?{cursor}:{});
    for (const object of page.objects) {
      assertNoSecrets(object,secrets,'native R2 key and metadata');
      const stored=await env.FILES.get(object.key);
      assert.ok(stored,'listed R2 object exists');
      assertNoSecrets(Buffer.from(await stored.arrayBuffer()),secrets,'native R2 bytes');
    }
    cursor=page.truncated?page.cursor:undefined;
  } while(cursor);
}

export async function assertMappedBusinessState(env,sources,files) {
  registerHooks({
    resolve(s,c,n){if(s.startsWith('.')&&c.parentURL)for(const ext of ['.ts','.tsx']){const u=new URL(s+ext,c.parentURL);if(existsSync(u))return n(u.href,c)}return n(s,c)},
    load(url,c,n){if(url.endsWith('.tsx'))return {format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return n(url,c)},
  });
  const {helpCenterRoutes}=await import('../../src/modules/public-site/help-center.tsx');
  for (const source of sources) {
    const project=source.tables.projects[0];
    const categories=(await env.DB.prepare('SELECT * FROM knowledge_categories WHERE project_id=? ORDER BY position,name').bind(project.id).all()).results;
    const original=[...source.tables.categories].sort((a,b)=>a._lft-b._lft);
    assert.deepEqual(categories.map(row=>row.id),original.map(row=>row.id),'H08 nested-set display order');
    for (const row of categories) assert.equal(row.parent_id,original.find(item=>item.id===row.id).parent_id,'H08 category parent');
    for (const dataset of source.tables.datasets) {
      const actual=await env.DB.prepare('SELECT * FROM knowledge_datasets WHERE id=?').bind(dataset.id).first();
      assert.deepEqual(JSON.parse(actual.excluded_urls),dataset.excluded_urls.split(/\r?\n/).filter(Boolean),'A22 crawl exclusions');
      assert.equal(actual.max_crawl_depth,dataset.max_crawl_depth,'A22 crawl depth, including zero');
      assert.equal(actual.max_crawl_pages,dataset.max_crawl_pages,'A22 crawl pages, including zero');
      assert.deepEqual(JSON.parse(actual.source_input),{crawl:{url:dataset.url,excluded_urls:JSON.parse(actual.excluded_urls),max_crawl_depth:dataset.max_crawl_depth,max_crawl_pages:dataset.max_crawl_pages}},'A22 retained crawl input keeps imported published sources editable and refreshable');
    }
    const email=await env.DB.prepare('SELECT * FROM email_settings WHERE project_id=?').bind(project.id).first();
    assert.ok(email,'C03 mailbox created');
    assert.equal(email.from_name,project.email_from_name,'C03 sender name');
    assert.equal(email.from_address,project.email_from_address,'C03 sender address');
    assert.equal(email.inbound_address,`${project.slug}@mail.example.test`,'C03 legacy receiving address');
    assert.equal(email.is_enabled,0,'C03 imported mailbox stays disabled');
    // Resolve the imported slug through the actual public help routes.
    const response=await helpCenterRoutes.request(`http://localhost/help/${project.slug}`,{},env);
    assert.equal(response.status,200,'C03 legacy slug resolves publicly');
    const html=await response.text();
    assert.ok(html.includes(project.name),'C03 slug resolves the correct project');
    assert.ok(html.indexOf('Getting started')<html.indexOf('Account overview'),'H08 published sibling order');
    assert.equal(html.includes('Unpublished billing tips'),false,'H08 draft categories stay private');
    const article=source.tables.articles.find(row=>row.published_at);
    // This published article also belongs to the unpublished billing collection.
    // Import preserves that lineage; the alias must obey the same publication
    // policy as every other help door rather than revive hidden knowledge.
    const hidden=await helpCenterRoutes.request(`http://localhost/help/${project.slug}/${article.slug}`,{},env);
    const missing=await helpCenterRoutes.request(`http://localhost/help/${project.slug}/missing-article`,{},env);
    assert.equal(hidden.status,404,'C03 unpublished collection withdraws the imported article alias');
    assert.equal(await hidden.text(),await missing.text(),'C03 hidden and missing imported article aliases are indistinguishable');
    const settings=await env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(project.id).first();
    assert.equal(JSON.parse(settings.settings_json).help_center_domain,new URL(`https://${project.help_center_domain}`).href,'H17 full HTTPS help-center URL');
    for (const insight of source.tables.insights) {
      const actual=await env.DB.prepare('SELECT * FROM context_insights WHERE id=?').bind(insight.id).first();
      assert.ok(actual,'R06 native insight exists');
      assert.equal(actual.dismissed_at,insight.closed_at?Date.parse(insight.closed_at):null,'R06 closed and active insight state');
      assert.equal(actual.content,insight.content,'R06 live insight content');
      const archived=await env.DB.prepare("SELECT source_json FROM legacy_import_rows WHERE source_table='insights' AND source_id=? LIMIT 1").bind(insight.id).first();
      const custody=JSON.parse(archived.source_json);
      for (const field of ['activated_at','closed_at','ai_id','metadata','analysis']) assert.deepEqual(custody[field],insight[field],`R06 archive custody: ${field}`);
    }
    const connection=source.tables.connections[0];
    assert.equal(connection.shared_key,undefined);assert.equal(connection.contact_shared_key,undefined);assert.equal(connection.contact_shared_key_id,undefined);
    assert.equal(source.tables.collector_actions[0].action,undefined,'encrypted collection action is excluded');
    assert.equal(source.tables.collector_actions[0].contact_shared_key_id,undefined);
    assert.equal(source.tables.project_github_connections[0].access_token,undefined);
  }
  for (const file of files) {
    const bundle=JSON.parse(await readFile(file,'utf8'));
    for (const object of bundle.objects) {
      const actual=await env.FILES.get(object.key);assert.ok(actual);
      assert.equal(createHash('sha256').update(Buffer.from(await actual.arrayBuffer())).digest('hex'),object.sha256);
    }
  }
}
