import type { KernelTransport } from '../src/types';
export class FakeKernel implements KernelTransport {
  notebook = '20261010000000-book001';
  docs = new Map<string, string>();
  blocks = new Map<string, { raw: string; root_id: string }>();
  calls: Array<{ path: string; body: any }> = [];
  fail?: string;
  lostCreate = false;
  lostAppend = false;
  lostUpdate = false;
  lostDelete = false;
  async post<T>(path: string, body: any = {}): Promise<T> {
    this.calls.push({ path, body });
    if (this.fail === path) throw new Error('kernel offline');
    let result: unknown;
    switch (path) {
      case '/api/sqlite/flushTransaction': result = null; break;
      case '/api/block/deleteBlock': {
        this.blocks.delete(body.id); result = [];
        if (this.lostDelete) { this.lostDelete = false; throw new Error('lost delete response'); } break;
      }
      case '/api/notebook/lsNotebooks': result = { notebooks: [{ id: this.notebook, name: 'Test', closed: false }] }; break;
      case '/api/template/renderSprig': result = body.template.replace('{{now | date "2006/01"}}', '2026/10').replace('{{now | date "20060102150405"}}', '20261010035000'); break;
      case '/api/filetree/getIDsByHPath': result = this.docs.has(body.path) ? [this.docs.get(body.path)] : []; break;
      case '/api/filetree/createDocWithMd': {
        const id = `20261010000000-d${String(this.docs.size + 1).padStart(6, '0')}`;
        this.docs.set(body.path, id); result = id;
        if (this.lostCreate) { this.lostCreate = false; throw new Error('lost create response'); }
        break;
      }
      case '/api/query/sql': {
        const id = /WHERE id = '([^']+)'/.exec(body.stmt)![1];
        result = this.blocks.has(id) ? [{ id, root_id: this.blocks.get(id)!.root_id }] : []; break;
      }
      case '/api/block/getBlockKramdown': {
        const block = this.blocks.get(body.id); if (!block) throw new Error('missing block');
        result = { id: body.id, kramdown: block.raw }; break;
      }
      case '/api/block/appendBlock': {
        const id = [...body.data.matchAll(/\{: id="([^"]+)"/g)].at(-1)[1];
        this.blocks.set(id, { raw: body.data, root_id: body.parentID }); result = [];
        if (this.lostAppend) { this.lostAppend = false; throw new Error('lost append response'); } break;
      }
      case '/api/block/updateBlock': {
        this.blocks.get(body.id)!.raw = body.data; result = [];
        if (this.lostUpdate) { this.lostUpdate = false; throw new Error('lost update response'); } break;
      }
      default: throw new Error(`Unknown API: ${path}`);
    }
    return result as T;
  }
}
