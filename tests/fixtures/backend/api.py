# Fixture FastAPI-ish routes for the intel scanner test.
@router.post("/firms")
def create_firm(payload):
    db.add(Firm(name=payload.name))
