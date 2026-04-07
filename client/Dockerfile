FROM nginx:alpine

# Copiar archivos del cliente
COPY . /usr/share/nginx/html

# Cambiar nginx a puerto 8080
RUN sed -i 's/listen       80;/listen       8080;/' /etc/nginx/conf.d/default.conf

# Dar permisos a carpetas necesarias para OpenShift
RUN mkdir -p /var/cache/nginx /var/run /var/log/nginx && \
    chmod -R 777 /var/cache/nginx /var/run /var/log/nginx

EXPOSE 8080