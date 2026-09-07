import { importedFn } from "./b";

interface IFace {
  tag?: string;
}

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
