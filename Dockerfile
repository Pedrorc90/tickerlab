# One image, both halves. The UI ships inside the jar and is served by the same origin as the
# API: splitting them onto a static host would buy a CORS setup and a cross-site session
# cookie, which is the trade keepory already refused.

# 1. The bundle.
FROM node:22-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2. The jar, with the bundle inside it. Dependencies are not cached in their own layer on
# purpose: dependency:go-offline is a second way for the build to fail, and this one runs on
# a push, not on a keystroke.
FROM maven:3-eclipse-temurin-21 AS backend
WORKDIR /backend
COPY backend/pom.xml ./
COPY backend/src ./src
COPY --from=frontend /frontend/dist/frontend/browser/ ./src/main/resources/static/
RUN mvn -B -q -DskipTests package

# 3. What actually runs. JRE and not JDK: the free plan has 512 MB and nothing here compiles.
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=backend /backend/target/*.jar app.jar
# The container is the whole machine, so the heap is a share of it and not a fixed number.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75"
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
