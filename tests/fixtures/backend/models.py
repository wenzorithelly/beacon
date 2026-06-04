# Fixture SQLAlchemy-ish models for the intel scanner test.
class Firm(Base):
    __tablename__ = "firms"
    id = Column(UUID, primary_key=True)
    name = Column(Text, nullable=False)


class User(Base):
    __tablename__ = "users"
    id = Column(UUID, primary_key=True)
    firm_id = Column(UUID, ForeignKey("firms.id"), nullable=False)
