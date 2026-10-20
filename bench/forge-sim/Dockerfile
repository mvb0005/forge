FROM eclipse-temurin:17.0.14_7-jre

ARG OTEL_AGENT_VERSION=2.31.1
ADD https://repo1.maven.org/maven2/io/opentelemetry/javaagent/opentelemetry-javaagent/${OTEL_AGENT_VERSION}/opentelemetry-javaagent-${OTEL_AGENT_VERSION}.jar /opt/otel/opentelemetry-javaagent.jar

# Forge looks for res/ in the working directory (release builds) or in ../forge-gui/ (git builds); this layout satisfies both
WORKDIR /opt/forge-gui
COPY --from=res . /opt/forge-gui/res
COPY --from=jar forge-gui-desktop-*-jar-with-dependencies.jar /opt/forge-gui/forge.jar
COPY --chmod=755 run.sh /opt/forge-gui/run.sh

ENTRYPOINT ["/opt/forge-gui/run.sh"]
