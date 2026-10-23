const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/pages/FormSettings/index.tsx'),'utf8');
const ast=ts.createSourceFile('index.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=['mapPlatformBusinessType','mapDesignerFieldType','makeRuntimeFormLayout'];
const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)).map(node=>node.getText(ast)).join('\n');
const layoutCtx={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/utils/formLayout.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,layoutCtx);
const ctx={buildRuntimeLayout:layoutCtx.exports.buildRuntimeLayout,getControlColumnSpan:layoutCtx.exports.getControlColumnSpan,getFieldBusinessType:field=>field.businessType,getEffectiveControlTypeForControl:control=>control.controlType};
vm.createContext(ctx);
vm.runInContext(ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
test('numeric storage types retain numeric controls and original field definitions',()=>{
 for(const storageType of ['integer','decimal','number','float']) {
  assert.equal(ctx.mapPlatformBusinessType(storageType,storageType),'number');
  assert.equal(ctx.mapDesignerFieldType({storageType,businessType:'number'}),storageType);
 }
 for(const storageType of ['date','datetime','enum','text','json']) assert.equal(ctx.mapDesignerFieldType({storageType,businessType:'text'}),storageType);
 assert.equal(ctx.mapPlatformBusinessType('person','string'),'person');
 assert.equal(ctx.mapPlatformBusinessType('attachment','json'),'attachment');
});
test('explicit designer optional rule overrides an old required field default',()=>{
 const layout=ctx.makeRuntimeFormLayout([{id:'title',fieldKey:'title',name:'标题',controlType:'text',width:'half',rules:{visible:{enabled:true},required:{enabled:false},readonly:{enabled:false}}}],[{key:'title',name:'标题',required:true}]);
 assert.equal(layout.sections[0].fields[0].required,false);
});
