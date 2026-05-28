"""
NLP Task Categorizer — scikit-learn TF-IDF + Logistic Regression pipeline.
Trained on a hand-curated dataset of task descriptions across 8 categories.
"""
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder

# ── Training Dataset ───────────────────────────────────────────────────────────
TRAINING_DATA = [
    # Development
    ("fix bug in authentication module", "Development"),
    ("implement new REST API endpoint", "Development"),
    ("refactor database queries for performance", "Development"),
    ("deploy application to production server", "Development"),
    ("debug login session issue", "Development"),
    ("write python script for data processing", "Development"),
    ("set up docker container", "Development"),
    ("review pull request and merge code", "Development"),
    ("migrate legacy code to new framework", "Development"),
    ("optimize slow SQL query", "Development"),
    ("integrate third party payment gateway", "Development"),
    ("add error handling to backend service", "Development"),
    ("update API documentation", "Development"),
    ("configure CI CD pipeline", "Development"),
    ("implement websocket real time feature", "Development"),
    ("create database migration script", "Development"),
    ("build REST API with FastAPI", "Development"),
    ("fix broken unit tests after refactor", "Development"),

    # Design
    ("create mockup for landing page", "Design"),
    ("design UI components in figma", "Design"),
    ("build wireframe for mobile app", "Design"),
    ("prototype new checkout flow", "Design"),
    ("update color palette and typography", "Design"),
    ("design icon set for dashboard", "Design"),
    ("create responsive layout for tablet", "Design"),
    ("redesign user profile page", "Design"),
    ("make pixel perfect design handoff", "Design"),
    ("design email newsletter template", "Design"),
    ("create illustrations for onboarding", "Design"),
    ("update brand style guide", "Design"),
    ("design data visualization charts", "Design"),

    # Research
    ("research best practices for machine learning deployment", "Research"),
    ("investigate competitor pricing models", "Research"),
    ("analyze user behavior data", "Research"),
    ("literature review on NLP techniques", "Research"),
    ("study react performance optimization", "Research"),
    ("compare cloud hosting providers", "Research"),
    ("evaluate new database technologies", "Research"),
    ("read paper on transformer architecture", "Research"),
    ("investigate memory leak in application", "Research"),
    ("benchmark algorithm performance", "Research"),
    ("explore open source alternatives", "Research"),
    ("market research for new feature", "Research"),

    # Testing
    ("write unit tests for payment service", "Testing"),
    ("run integration tests on staging", "Testing"),
    ("perform load testing on API endpoints", "Testing"),
    ("automate regression test suite", "Testing"),
    ("write end to end tests with selenium", "Testing"),
    ("QA review of new feature release", "Testing"),
    ("test cross browser compatibility", "Testing"),
    ("create test plan for sprint", "Testing"),
    ("fix failing automated tests", "Testing"),
    ("conduct user acceptance testing", "Testing"),
    ("test mobile responsiveness", "Testing"),
    ("validate form input edge cases", "Testing"),

    # Personal
    ("book dentist appointment", "Personal"),
    ("grocery shopping list", "Personal"),
    ("call mom on weekend", "Personal"),
    ("pay monthly bills", "Personal"),
    ("plan vacation itinerary", "Personal"),
    ("workout at gym", "Personal"),
    ("cook dinner for family", "Personal"),
    ("renew car insurance", "Personal"),
    ("clean and organize home office", "Personal"),
    ("pick up kids from school", "Personal"),
    ("schedule annual health checkup", "Personal"),
    ("send birthday gift", "Personal"),

    # Admin
    ("prepare weekly project status report", "Admin"),
    ("schedule team standup meeting", "Admin"),
    ("send email to stakeholders", "Admin"),
    ("update project documentation", "Admin"),
    ("organize team retrospective", "Admin"),
    ("review and approve timesheets", "Admin"),
    ("prepare quarterly budget report", "Admin"),
    ("onboard new team member", "Admin"),
    ("update project roadmap in jira", "Admin"),
    ("coordinate client presentation", "Admin"),
    ("write meeting notes and action items", "Admin"),
    ("create slide deck for demo", "Admin"),
    ("track project milestones", "Admin"),

    # Learning
    ("complete python machine learning course", "Learning"),
    ("watch tutorial on kubernetes", "Learning"),
    ("practice leetcode problems", "Learning"),
    ("read clean code book chapter", "Learning"),
    ("take online deep learning course", "Learning"),
    ("learn react hooks concepts", "Learning"),
    ("study system design patterns", "Learning"),
    ("attend webinar on cloud architecture", "Learning"),
    ("practice SQL query optimization", "Learning"),
    ("learn docker basics tutorial", "Learning"),
    ("complete data structures assignment", "Learning"),
    ("study for certification exam", "Learning"),
    ("follow along with fastapi tutorial", "Learning"),

    # Urgent
    ("URGENT fix production server crash", "Urgent"),
    ("critical security vulnerability patch", "Urgent"),
    ("emergency database backup needed", "Urgent"),
    ("deadline today submit project report", "Urgent"),
    ("ASAP resolve customer data loss issue", "Urgent"),
    ("immediately rollback broken deployment", "Urgent"),
    ("blocker issue preventing release", "Urgent"),
    ("hotfix required for live site down", "Urgent"),
    ("escalated client complaint needs resolution", "Urgent"),
    ("last minute presentation changes required", "Urgent"),
    ("urgent meeting with CEO in one hour", "Urgent"),
    ("critical bug in payment processing", "Urgent"),
]

# Category → default priority mapping
CATEGORY_PRIORITY = {
    "Urgent":      "high",
    "Development": "medium",
    "Testing":     "medium",
    "Design":      "medium",
    "Admin":       "medium",
    "Research":    "low",
    "Learning":    "low",
    "Personal":    "low",
}

# Category → suggested tags
CATEGORY_TAGS = {
    "Development": ["dev", "code", "backend"],
    "Design":      ["design", "ui", "ux"],
    "Research":    ["research", "analysis"],
    "Testing":     ["qa", "testing"],
    "Personal":    ["personal"],
    "Admin":       ["admin", "meeting"],
    "Learning":    ["learning", "study"],
    "Urgent":      ["urgent", "critical"],
}


class TaskCategorizer:
    """
    Scikit-learn ML pipeline: TF-IDF (bigrams) + Logistic Regression.
    Predicts task category from free-text title/description.
    """

    def __init__(self):
        self.pipeline = Pipeline([
            ("tfidf", TfidfVectorizer(
                ngram_range=(1, 2),
                max_features=2000,
                sublinear_tf=True,
                min_df=1,
            )),
            ("clf", LogisticRegression(
                max_iter=500,
                C=1.5,
                solver="lbfgs",
                multi_class="multinomial",
            )),
        ])
        self._train()

    def _train(self):
        texts, labels = zip(*TRAINING_DATA)
        self.pipeline.fit(texts, labels)
        self.classes_ = self.pipeline.classes_

    def predict(self, text: str) -> dict:
        """Return category, confidence, all class scores, priority, and tags."""
        if not text or not text.strip():
            return {
                "category": "Development",
                "confidence": 0.0,
                "suggested_priority": "medium",
                "suggested_tags": [],
                "all_scores": {},
            }

        proba = self.pipeline.predict_proba([text.lower()])[0]
        idx = int(np.argmax(proba))
        category = self.classes_[idx]
        confidence = float(proba[idx])

        return {
            "category": category,
            "confidence": round(confidence, 3),
            "suggested_priority": CATEGORY_PRIORITY.get(category, "medium"),
            "suggested_tags": CATEGORY_TAGS.get(category, []),
            "all_scores": {
                cls: round(float(p), 3)
                for cls, p in zip(self.classes_, proba)
            },
        }


# Singleton — trained once at import time
categorizer = TaskCategorizer()
