declare module 'turndown-plugin-gfm' {
  import TurndownService from 'turndown';
  export interface Options {
    strikethrough: boolean;
    taskListItems: boolean;
    fencedCodeBlocks: boolean;
  }
  export const gfm: TurndownService.Plugin | TurndownService.Plugin[];
}
