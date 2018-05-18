FROM golang:1.10-stretch

RUN apt-get update && apt-get install -y apt-transport-https

RUN curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add - && \
  echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list

RUN curl -sL https://deb.nodesource.com/setup_10.x | bash -

RUN apt-get update && apt-get install -y \
  nodejs \
  yarn \
  libgtk2.0-0 \
  libx11-dev \
  libx11-xcb-dev \
  libxkbfile-dev \
  libxtst6 \
  libxss1 \
  libgconf-2-4 \
  libasound2 \
  libcanberra-gtk-module \
  libnss3 \
  xvfb

RUN go get github.com/ramya-rao-a/go-outline
