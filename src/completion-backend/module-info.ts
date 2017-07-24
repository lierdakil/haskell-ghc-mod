/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS104: Avoid inline assignments
 * DS206: Consider reworking classes to avoid initClass
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
import { CompositeDisposable, Emitter } from 'atom'
import * as Util from '../util'
import {GhcModiProcess} from '../ghc-mod'
import {BufferInfo, IImport} from './buffer-info'
import {SymbolDesc, SymbolType} from '../ghc-mod'

export class ModuleInfo {
  public readonly initialUpdatePromise: Promise<void>
  private symbols: SymbolDesc[] // module symbols
  private disposables: CompositeDisposable
  private emitter: Emitter
  private timeout: NodeJS.Timer
  private invalidateInterval = 30 * 60 * 1000 // if module unused for 30 minutes, remove it
  private bufferSet: WeakSet<AtomTypes.TextBuffer>

  constructor (private name: string, private process: GhcModiProcess, private rootDir: AtomTypes.Directory) {
    Util.debug(`${this.name} created`)
    this.symbols = []
    this.disposables = new CompositeDisposable()
    this.bufferSet = new WeakSet()
    this.emitter = new Emitter()
    this.disposables.add(this.emitter)
    this.initialUpdatePromise = this.update(rootDir)
    this.timeout = setTimeout(this.destroy.bind(this), this.invalidateInterval)
    this.disposables.add(this.process.onDidDestroy(this.destroy.bind(this)))
  }

  public destroy () {
    Util.debug(`${this.name} destroyed`)
    clearTimeout(this.timeout)
    this.emitter.emit('did-destroy')
    this.disposables.dispose()
  }

  public onDidDestroy (callback: () => void) {
    return this.emitter.on('did-destroy', callback)
  }

  public async setBuffer (bufferInfo: BufferInfo) {
    const name = await bufferInfo.getModuleName()
    if (name !== this.name) { return }
    if (this.bufferSet.has(bufferInfo.buffer)) { return }
    this.bufferSet.add(bufferInfo.buffer)
    Util.debug(`${this.name} buffer is set`)
    const disposables = new CompositeDisposable()
    disposables.add(bufferInfo.buffer.onDidSave(() => {
      Util.debug(`${this.name} did-save triggered`)
      this.update(this.rootDir)
    }))
    disposables.add(bufferInfo.buffer.onDidDestroy(() => {
      disposables.dispose()
      this.bufferSet.delete(bufferInfo.buffer)
      this.disposables.remove(disposables)
    }))
    this.disposables.add(disposables)
  }

  public select (importDesc: IImport, symbolTypes?: SymbolType[], skipQualified: boolean = false) {
    clearTimeout(this.timeout)
    this.timeout = setTimeout(this.destroy.bind(this), this.invalidateInterval)
    let symbols = this.symbols
    if (importDesc.importList) {
      const il = importDesc.importList
      symbols = symbols.filter((s) => {
        const inImportList = il.includes(s.name)
        const parentInImportList = il.some((i) => (typeof i !== 'string') && (s.parent === i.parent))
        const shouldShow = inImportList || parentInImportList
        return importDesc.hiding !== shouldShow // XOR
      })
    }
    const res = []
    for (const symbol of symbols) {
      if (symbolTypes && !symbolTypes.includes(symbol.symbolType)) { continue }
      const specific = {
        name: symbol.name,
        typeSignature: symbol.typeSignature,
        symbolType: symbol.symbolType,
        module: importDesc
      }
      const qn = (n: string) => `${importDesc.alias || importDesc.name}.${n}`
      if (!skipQualified) {
        res.push({
          ...specific,
          qparent: symbol.parent ? qn(symbol.parent) : undefined,
          qname: qn(symbol.name)
        })
      }
      if (! importDesc.qualified) {
        res.push({
          ...specific,
          qparent: symbol.parent,
          qname: symbol.name
        })
      }
    }
    return res
  }

  private async update (rootDir: AtomTypes.Directory) {
    Util.debug(`${this.name} updating`)
    this.symbols = await this.process.runBrowse(rootDir, [this.name])
    Util.debug(`${this.name} updated`)
  }
}
