package sample

import (
	"fmt"
	str "strings"
)

func (e *Early) M() {
	fmt.Println(str.ToUpper("x"))
}

type Early struct{}
