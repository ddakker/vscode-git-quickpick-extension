## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review

## 빌드 방법
```
./package.sh
```

## 규칙
- 요청으로 소스코드가 수정되면 언제나 빌드를 실행해라.
- git 명령어 등 모든 명령은 로그로 출력하되 명령에 대한 응답은 정상인 경우 앞에 2~3줄만하고 생략 표시,에러는 전체 출력한다.
  - "[yyyy-MM-dd HH:mm:ss] 명령" 패턴으로 날짜 시간을 앞에 추가
