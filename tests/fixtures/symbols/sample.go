package sample

type Base struct {
	X int
}

func Helper() {}

func (b *Base) Method() {
	Helper()
	b.Other()
}

func (b *Base) Other() {}

func unexported() {}
