"""Optional, repeatable assignment seed. Run from backend: python -m app.seed."""
from sqlalchemy import select
from .main import SessionLocal, User, Meeting, hash_password

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "ZoomDemo123!"
SAMPLES = [("910 001 001", "Product stand-up", "Discuss progress and next steps."),
           ("910 001 002", "Design review", "Review the latest interface together.")]

def seed():
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
        if not user:
            user = User(email=DEMO_EMAIL, name="Demo User", password_hash=hash_password(DEMO_PASSWORD))
            db.add(user)
            db.flush()
        for meeting_id, title, description in SAMPLES:
            if not db.scalar(select(Meeting).where(Meeting.meeting_id == meeting_id)):
                db.add(Meeting(meeting_id=meeting_id, title=title, description=description,
                    host_name=user.name, owner_user_id=user.id, duration_minutes=40,
                    is_scheduled=False, scheduled_at=None))
        db.commit()
    print("Seed complete. Demo account: demo@example.com / ZoomDemo123!")
    print("Two sample recent meetings; no scheduled meetings. New accounts remain empty.")

if __name__ == "__main__":
    seed()
