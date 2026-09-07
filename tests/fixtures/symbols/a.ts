import { importedFn } from "./b";

interface IFace { tag?: string } // one line: the tests below assert this fixture's line numbers

class Base {}

export class Foo extends Base implements IFace {
  method() {
    sameFileFn();
    importedFn();
    inferredOnly();
    ambiguousName();
  }
}

function sameFileFn() {}
