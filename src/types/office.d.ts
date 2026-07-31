// 为没有自带 TypeScript 类型的 npm 包提供极简类型声明

declare module 'pptx2json' {
  export default class PPTX2Json {
    constructor(options?: { jszipBinary?: string; jszipGenerateType?: string });
    toJson(file: string): Promise<Record<string, unknown>>;
    toPPTX(json: Record<string, unknown>, options?: { file?: string }): Promise<Buffer | undefined>;
  }
}

declare module 'turndown' {
  export default class TurndownService {
    constructor(options?: {
      headingStyle?: 'setext' | 'atx';
      bulletListMarker?: '-' | '+' | '*';
      codeBlockStyle?: 'indented' | 'fenced';
      [key: string]: any;
    });
    use(plugin: any): this;
    turndown(html: string): string;
  }
}

declare module 'turndown-plugin-gfm' {
  export const gfm: (turndown: any) => void;
}
