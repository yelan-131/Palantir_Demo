const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
const uuidContext={exports:{},crypto:require('node:crypto').webcrypto};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/utils/uuid.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,uuidContext);
const ctx={exports:{},require:name=>{if(name==='@/utils/uuid')return uuidContext.exports;throw new Error(name);}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/utils/formDefaults.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
const {newDefaultPart,defaultRuleSummary,defaultRuleErrors}=ctx.exports;
const fields=[{key:'a',name:'名称',storageType:'string'},{key:'b',name:'规格',storageType:'string'},{key:'rows',name:'明细',storageType:'json'}];
test('conditional fixed defaults validate references, values and dependency cycles',()=>{
 const rule=(source,value='RAW')=>({mode:'fixed',conditions:[{sourceField:source,operator:'eq',value}]});
 assert.equal(defaultRuleErrors([{fieldKey:'b',defaultRule:rule('a')}],fields).length,0);
 for(const invalid of [rule('missing'),rule('b'),rule('a','')])assert.ok(defaultRuleErrors([{fieldKey:'b',defaultRule:invalid}],fields).length);
 assert.ok(defaultRuleErrors([{fieldKey:'a',defaultRule:rule('b')},{fieldKey:'b',defaultRule:rule('a')}],fields).some(error=>error.includes('循环')));
});
test('default parts have stable unique identities and readable configuration summaries',()=>{
 const one=newDefaultPart('text'),two=newDefaultPart('field');assert.notEqual(one.id,two.id);
 const rule={mode:'template',parts:[{...one,value:'MAT-'},{...two,value:'a'}]};
 assert.equal(defaultRuleSummary(rule,fields),'"MAT-" + 「名称」');
 assert.deepEqual(JSON.parse(JSON.stringify(rule)).parts[1],JSON.parse(JSON.stringify({...two,value:'a'})));
});
test('empty, self, deleted, structured and cyclic field references block configuration',()=>{
 const rule=(field)=>({mode:'template',parts:[{id:field,kind:'field',value:field}]});
 assert.equal(defaultRuleErrors([{fieldKey:'b',defaultRule:rule('a')}],fields).length,0);
 for(const reference of ['b','missing','rows'])assert.ok(defaultRuleErrors([{fieldKey:'b',defaultRule:rule(reference)}],fields).length);
 assert.ok(defaultRuleErrors([{fieldKey:'a',defaultRule:rule('b')},{fieldKey:'b',defaultRule:rule('a')}],fields).some(error=>error.includes('循环')));
 assert.ok(defaultRuleErrors([{fieldKey:'a',defaultRule:{mode:'template',parts:[]}}],fields).length);
 assert.equal(defaultRuleErrors([{fieldKey:'a',defaultRule:{mode:'fixed'}}],fields).length,0);
});
