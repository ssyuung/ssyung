import type { NextConfig } from "next";

// 모듈 패키지는 .ts 소스를 그대로 export한다. Next가 같이 컴파일한다.
// @ssyung/school-data는 번들하지 않는다(server/deps.ts loadSchoolData 참고).
const config: NextConfig = {
  transpilePackages: ["@ssyung/schema", "@ssyung/core", "@ssyung/repository", "@ssyung/scheduler"],
};

export default config;
