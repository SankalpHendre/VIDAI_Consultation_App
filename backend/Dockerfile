# /backend/Dockerfile

FROM python:3.12.10

# 2. Set the working directory
WORKDIR /app

# 3. Copy the requirements file and install dependencies
COPY requirements_mini.txt .
RUN pip install --no-cache-dir -r requirements_mini.txt
run
# 4. Copy the rest of the Django project code
COPY . .

# 5. Expose the port Django runs on
EXPOSE 8000

# 6. Start the Django server 
# (Note: For production, you should swap this to use Gunicorn)
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]