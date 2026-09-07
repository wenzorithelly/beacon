pub struct Point {
    pub x: i32,
}

trait Shape {
    fn area(&self) -> f64;
}

impl Shape for Point {
    fn area(&self) -> f64 {
        self.helper();
        top_level();
        0.0
    }
}

impl Point {
    fn helper(&self) -> f64 {
        1.0
    }
}

fn top_level() {}
