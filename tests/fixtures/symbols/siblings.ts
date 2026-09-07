export class First {
  render() {}
}

export class Second {
  render() {}
  paint() {
    this.render();
  }
}
