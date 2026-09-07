class Base:
    pass


class Foo(Base):
    def method(self):
        self.helper()
        top_level()

    def helper(self):
        pass


def top_level():
    pass


def _private():
    pass


class Decorated:
    @staticmethod
    def util():
        pass

    @property
    def value(self):
        return 1
