FROM eclipse-temurin:17-jre

# res/ sits next to a forge-gui directory so a git checkout and this image resolve it the same way.
WORKDIR /opt/forge
COPY --from=res . /opt/forge/forge-gui/res
COPY --from=jar forge-gui-web-*-jar-with-dependencies.jar /opt/forge/forge-web.jar
COPY --from=ui . /opt/forge/ui

ENV HOME=/data
VOLUME /data
EXPOSE 7777

ENTRYPOINT ["sh", "-c", "exec java -Duser.home=/data $JAVA_OPTS -jar /opt/forge/forge-web.jar --host 0.0.0.0 --port 7777 --ui /opt/forge/ui --pics /pics"]
